"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AddLayerObject, GeoJSONSource, Map as MapLibreMap, MapMouseEvent, Marker, PointLike } from "maplibre-gl";
import { ArrowLeft, ArrowUpRight, ChevronRight, LocateFixed, Search, Star, X } from "lucide-react";
import { destination, distanceKm, type LatLon } from "@/lib/geo";
import { nextSunset } from "@/lib/sun";
import {
  KIND_LABELS,
  VIEWS,
  rankSpots,
  showTonight,
  sunHidesAt,
  tileKey,
  tilesAround,
  viewTonight,
  walkMinutes,
  type Spot,
  type SpotIndex,
  type View,
} from "@/lib/spots";
import { useFavorites } from "./favorites";
import { readCachedForecast } from "./forecastCache";
import { KIND_FILTERS, filtersActive, passesFilters, useMapFilters, type MapFilters } from "./mapFilters";
import { PlaceSearch } from "./PlaceSearch";
import { skyPalette } from "./sky";
import { VIEW_COLORS, timeFormatter } from "./spotStyle";
import { useWalkMinutes, usePlace, walkRadiusKm } from "./usePlace";
import { ViewPostcard } from "./ViewPostcard";

const STYLE_URL = "https://tiles.openfreemap.org/styles/dark";
const MIN_ZOOM_FOR_SPOTS = 11.5;
const LEGEND: View[] = ["open", "low", "sky", "blocked"];
const LEGEND_SHORT: Record<View, string> = { open: "Open", low: "Low", sky: "Sky", blocked: "Blocked" };

/**
 * How far from a pin a tap still picks it, in px. A fingertip covers about 45 px, far more than a pin,
 * so a tap picks the nearest pin within reach instead of needing to land on the dot itself.
 */
const HIT_RADIUS = { touch: 28, mouse: 14 };
/** Space the header and filter chips take at the top of the map, px. */
const HEADER_SPACE = 130;
/** The sunset beam: how far it reaches (km) and how wide it fans out (± degrees), like the sky the colors fill. */
const BEAM_KM = [0.45, 0.9, 1.35];
const BEAM_HALF_ANGLE = 20;

/** Better views draw on top of worse ones where pins overlap. */
const VIEW_RANK: Record<View | "unknown", number> = { open: 4, low: 3, sky: 2, unknown: 1, blocked: 0 };

type CirclePaint = NonNullable<Extract<AddLayerObject, { type: "circle" }>["paint"]>;
type MapLib = typeof import("maplibre-gl");

/** Pin radius by zoom, px, optionally scaled and padded (for halos and rings). */
const pinRadius = (scale = 1, pad = 0): CirclePaint["circle-radius"] => [
  "interpolate",
  ["linear"],
  ["zoom"],
  11,
  4 * scale + pad,
  13,
  6 * scale + pad,
  15,
  8 * scale + pad,
  17,
  11 * scale + pad,
];

type FeatureCollection = GeoJSON.FeatureCollection;
const EMPTY: FeatureCollection = { type: "FeatureCollection", features: [] };

function circle(center: LatLon, radiusKm: number): FeatureCollection {
  const ring = Array.from({ length: 65 }, (_, i) => {
    const p = destination(center, (i * 360) / 64, radiusKm);
    return [p.lon, p.lat];
  });
  return { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [ring] } }] };
}

/** Nested wedges toward the sunset; drawn faintly on top of each other they fade with distance. */
function beam(from: LatLon, bearing: number): FeatureCollection {
  const wedge = (km: number) => {
    const arc = Array.from({ length: 9 }, (_, i) => {
      const p = destination(from, bearing - BEAM_HALF_ANGLE + (i * 2 * BEAM_HALF_ANGLE) / 8, km);
      return [p.lon, p.lat];
    });
    return [[from.lon, from.lat], ...arc, [from.lon, from.lat]];
  };
  const end = destination(from, bearing, BEAM_KM[BEAM_KM.length - 1]);
  return {
    type: "FeatureCollection",
    features: [
      ...BEAM_KM.map((km) => ({ type: "Feature" as const, properties: {}, geometry: { type: "Polygon" as const, coordinates: [wedge(km)] } })),
      { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [[from.lon, from.lat], [end.lon, end.lat]] } },
    ],
  };
}

/** The id of the pin nearest to a screen point, if one is within `radius` px. */
function spotNear(map: MapLibreMap, point: { x: number; y: number }, radius: number): string | null {
  const box: [PointLike, PointLike] = [
    [point.x - radius, point.y - radius],
    [point.x + radius, point.y + radius],
  ];
  let best: { id: string; distance: number } | null = null;
  for (const feature of map.queryRenderedFeatures(box, { layers: ["spots"] })) {
    if (feature.geometry.type !== "Point") continue;
    const at = map.project(feature.geometry.coordinates as [number, number]);
    const distance = Math.hypot(at.x - point.x, at.y - point.y);
    if (distance <= radius && (!best || distance < best.distance)) {
      best = { id: String(feature.properties.id), distance };
    }
  }
  return best?.id ?? null;
}

/** Fingers and pens get a bigger reach than a mouse pointer. */
function hitRadius(event: MapMouseEvent): number {
  const pointerType = (event.originalEvent as PointerEvent).pointerType;
  const touch = pointerType ? pointerType !== "mouse" : window.matchMedia("(pointer: coarse)").matches;
  return touch ? HIT_RADIUS.touch : HIT_RADIUS.mouse;
}

export default function SpotMap() {
  const { place, locate, choose } = usePlace();
  const [walk] = useWalkMinutes();
  const { favorites, isFavorite, toggle } = useFavorites();
  const [filters, setFilters] = useMapFilters();
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const libRef = useRef<MapLib | null>(null);
  const tiles = useRef(new Map<string, Spot[]>());
  const [ready, setReady] = useState(false);
  const [index, setIndex] = useState<SpotIndex | null>(null);
  const [spots, setSpots] = useState<Spot[]>([]);
  const [zoomedOut, setZoomedOut] = useState(false);
  const [selected, setSelected] = useState<Spot | null>(null);
  const [sheet, setSheet] = useState<HTMLDivElement | null>(null);
  const [searching, setSearching] = useState(false);

  const sun = useMemo(() => (place ? nextSunset(new Date(), place.lat, place.lon) : null), [place]);
  const favoriteIds = useMemo(() => new Set(favorites.map((f) => f.id)), [favorites]);

  // The same top 3 as "Best near you" on the Tonight screen.
  const ranked = useMemo(
    () => (place && sun && index ? rankSpots(spots, place, sun.bearing, walk, index.profile).slice(0, 3) : []),
    [spots, place, sun, walk, index],
  );
  const rankOf = useMemo(() => new Map(ranked.map((r, i) => [r.spot.id, i + 1])), [ranked]);

  // Create the map once we know where to centre it.
  useEffect(() => {
    if (!place || mapRef.current || !container.current) return;
    let cancelled = false;
    import("maplibre-gl").then((maplibregl) => {
      if (cancelled || !container.current || mapRef.current) return;
      libRef.current = maplibregl;
      maplibregl.setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");
      const map = new maplibregl.Map({
        container: container.current,
        style: STYLE_URL,
        center: [place.lon, place.lat],
        zoom: 13.4,
        attributionControl: { compact: true },
      });
      mapRef.current = map;
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
      map.on("load", () => {
        map.addSource("walk", { type: "geojson", data: EMPTY });
        map.addLayer({ id: "walk-fill", type: "fill", source: "walk", paint: { "fill-color": "#f08a3c", "fill-opacity": 0.05 } });
        map.addLayer({
          id: "walk-line",
          type: "line",
          source: "walk",
          paint: { "line-color": "#f08a3c", "line-opacity": 0.5, "line-width": 1.5, "line-dasharray": [2, 2] },
        });
        map.addSource("beam", { type: "geojson", data: EMPTY });
        map.addLayer({
          id: "beam-fill",
          type: "fill",
          source: "beam",
          filter: ["==", ["geometry-type"], "Polygon"],
          paint: { "fill-color": "#ffc35c", "fill-opacity": 0.1 },
        });
        map.addLayer({
          id: "beam-line",
          type: "line",
          source: "beam",
          filter: ["==", ["geometry-type"], "LineString"],
          paint: { "line-color": "#ffc35c", "line-width": 2, "line-dasharray": [1, 2] },
        });
        map.addSource("spots", { type: "geojson", data: EMPTY });
        map.addSource("selected", { type: "geojson", data: EMPTY });
        // A soft glow under the spots with a good view tonight, so they stand out.
        map.addLayer({
          id: "spots-glow",
          type: "circle",
          source: "spots",
          filter: ["get", "good"],
          paint: { "circle-color": ["get", "color"], "circle-radius": pinRadius(2.2), "circle-opacity": 0.22, "circle-blur": 1 },
        });
        map.addLayer({
          id: "selected-halo",
          type: "circle",
          source: "selected",
          paint: { "circle-color": ["get", "color"], "circle-radius": pinRadius(1, 12), "circle-opacity": 0.35, "circle-blur": 0.6 },
        });
        map.addLayer({
          id: "spots",
          type: "circle",
          source: "spots",
          layout: { "circle-sort-key": ["get", "rank"] },
          paint: {
            "circle-color": ["get", "color"],
            "circle-radius": pinRadius(),
            // Favorites get a light ring.
            "circle-stroke-color": ["case", ["get", "fav"], "#fff7ec", "#0d0b14"],
            "circle-stroke-width": ["case", ["get", "fav"], 2.5, 2],
          },
        });
        map.addLayer({
          id: "selected-ring",
          type: "circle",
          source: "selected",
          paint: {
            "circle-color": ["get", "color"],
            "circle-radius": pinRadius(1, 2),
            "circle-stroke-color": "#fff7ec",
            "circle-stroke-width": 3,
          },
        });
        map.addSource("me", { type: "geojson", data: EMPTY });
        map.addLayer({
          id: "me",
          type: "circle",
          source: "me",
          paint: { "circle-color": "#5aa9ff", "circle-radius": 6, "circle-stroke-color": "#ffffff", "circle-stroke-width": 2 },
        });
        setReady(true);
      });
      // Pick the nearest pin within reach of the tap; a tap on open map closes the spot card.
      map.on("click", (event) => {
        const id = spotNear(map, event.point, hitRadius(event));
        const spot = id ? [...tiles.current.values()].flat().find((s) => s.id === id) : undefined;
        setSelected(spot ?? null);
      });
      map.on("mousemove", (event) => {
        map.getCanvas().style.cursor = spotNear(map, event.point, HIT_RADIUS.mouse) ? "pointer" : "";
      });
    });
    return () => {
      cancelled = true;
    };
  }, [place]);

  useEffect(
    () => () => {
      mapRef.current?.remove();
      mapRef.current = null;
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
    fetch("/data/spots/index.json")
      .then((r) => r.json() as Promise<SpotIndex>)
      .then((data) => !cancelled && setIndex(data))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  // Load the tiles covering the visible area, and the walk around the place, after each move.
  const loadVisible = useCallback(async () => {
    const map = mapRef.current;
    if (!map || !index) return;
    const zoomedOutNow = map.getZoom() < MIN_ZOOM_FOR_SPOTS;
    setZoomedOut(zoomedOutNow);
    const center = map.getCenter();
    const corner = map.getBounds().getNorthEast();
    const radius = distanceKm({ lat: center.lat, lon: center.lng }, { lat: corner.lat, lon: corner.lng });
    const wanted = new Set(place ? tilesAround(place, walkRadiusKm(walk), index) : []);
    if (!zoomedOutNow) tilesAround({ lat: center.lat, lon: center.lng }, radius, index).forEach((k) => wanted.add(k));
    const missing = [...wanted].filter((k) => !tiles.current.has(k));
    if (!missing.length) return;
    await Promise.all(
      missing.map(async (key) => {
        const response = await fetch(`/data/spots/${key}.json`);
        tiles.current.set(key, response.ok ? ((await response.json()) as { spots: Spot[] }).spots : []);
      }),
    );
    setSpots([...tiles.current.values()].flat());
  }, [index, place, walk]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !index) return;
    const id = setTimeout(loadVisible, 0);
    map.on("moveend", loadVisible);
    return () => {
      clearTimeout(id);
      map.off("moveend", loadVisible);
    };
  }, [ready, index, loadVisible]);

  // Keep the map's layers in step with state.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !sun || !index) return;
    const features = spots.flatMap((spot) => {
      const { view } = viewTonight(spot, sun.bearing, index.profile);
      if (!showTonight(spot, view) || !passesFilters(spot, view, filters)) return [];
      return [
        {
          type: "Feature" as const,
          properties: {
            id: spot.id,
            color: VIEW_COLORS[view ?? "unknown"],
            rank: VIEW_RANK[view ?? "unknown"],
            good: view === "open" || view === "low",
            fav: favoriteIds.has(spot.id),
          },
          geometry: { type: "Point" as const, coordinates: [spot.lon, spot.lat] },
        },
      ];
    });
    (map.getSource("spots") as GeoJSONSource).setData({ type: "FeatureCollection", features });
  }, [ready, spots, sun, index, filters, favoriteIds]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !place) return;
    (map.getSource("walk") as GeoJSONSource).setData(circle(place, walkRadiusKm(walk)));
    (map.getSource("me") as GeoJSONSource).setData({
      type: "FeatureCollection",
      features: [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [place.lon, place.lat] } }],
    });
  }, [ready, place, walk]);

  // The sunset beam from the selected spot (or from you), with a sun at its end.
  useEffect(() => {
    const map = mapRef.current;
    const lib = libRef.current;
    if (!ready || !map || !lib || !sun) return;
    const from = selected ?? place;
    (map.getSource("beam") as GeoJSONSource).setData(from ? beam(from, sun.bearing) : EMPTY);
    if (!from) return;
    const end = destination(from, sun.bearing, BEAM_KM[BEAM_KM.length - 1]);
    const element = document.createElement("div");
    element.className = "sun-marker";
    element.setAttribute("aria-hidden", "true");
    const dot = document.createElement("span");
    dot.className = "sun-marker-dot";
    const label = document.createElement("span");
    label.className = "sun-marker-label";
    label.textContent = `Sunset ${timeFormatter()(sun.sunset)}`;
    element.append(dot, label);
    const marker = new lib.Marker({ element }).setLngLat([end.lon, end.lat]).addTo(map);
    return () => {
      marker.remove();
    };
  }, [ready, selected, place, sun]);

  // Number the top 3, matching "Best near you". A badge is a button: it opens its spot.
  useEffect(() => {
    const map = mapRef.current;
    const lib = libRef.current;
    if (!ready || !map || !lib) return;
    const markers: Marker[] = ranked.flatMap((r, i) => {
      if (!passesFilters(r.spot, r.view, filters)) return [];
      const button = document.createElement("button");
      button.type = "button";
      button.className = "rank-badge";
      button.dataset.selected = String(selected?.id === r.spot.id);
      button.style.setProperty("--badge", VIEW_COLORS[r.view ?? "unknown"]);
      button.setAttribute("aria-label", `Number ${i + 1} tonight: ${r.spot.name}`);
      const number = document.createElement("span");
      number.textContent = String(i + 1);
      button.append(number);
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        setSelected(r.spot);
      });
      return [new lib.Marker({ element: button }).setLngLat([r.spot.lon, r.spot.lat]).addTo(map)];
    });
    return () => markers.forEach((m) => m.remove());
  }, [ready, ranked, filters, selected]);

  // Ring the selected pin, so it's clear which spot the card is about.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !sun || !index) return;
    const view = selected ? viewTonight(selected, sun.bearing, index.profile).view : null;
    (map.getSource("selected") as GeoJSONSource).setData(
      selected
        ? {
            type: "FeatureCollection",
            features: [
              {
                type: "Feature",
                properties: { color: VIEW_COLORS[view ?? "unknown"] },
                geometry: { type: "Point", coordinates: [selected.lon, selected.lat] },
              },
            ],
          }
        : EMPTY,
    );
  }, [ready, selected, sun, index]);

  // Keep the map buttons above the spot card, and the selected pin out from under it.
  useEffect(() => {
    const map = mapRef.current;
    const main = container.current?.closest("main");
    if (!sheet || !main) return;
    /** Top of the card, in px from the top of the map. */
    const cardTop = () => sheet.getBoundingClientRect().top - main.getBoundingClientRect().top;
    const lift = () => main.style.setProperty("--sheet-h", `${main.clientHeight - cardTop()}px`);
    lift();
    const observer = new ResizeObserver(lift);
    observer.observe(sheet);
    if (map && selected) {
      const at = map.project([selected.lon, selected.lat]);
      const top = HEADER_SPACE;
      const bottom = cardTop();
      const margin = 32;
      if (at.y < top + margin || at.y > bottom - margin) map.panBy([0, at.y - (top + bottom) / 2]);
    }
    return () => {
      observer.disconnect();
      main.style.setProperty("--sheet-h", "0px");
    };
  }, [sheet, selected]);

  const recenter = () => {
    if (place?.source !== "search") locate();
    if (place) mapRef.current?.flyTo({ center: [place.lon, place.lat], zoom: 14 });
  };

  return (
    <main className="spot-map relative h-dvh w-full">
      <div className="absolute inset-0">
        <div ref={container} className="h-full w-full" />
      </div>

      <header className="pointer-events-none absolute inset-x-0 top-0 space-y-2 p-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <div className="flex items-start justify-between gap-2">
          <Link
            href="/"
            className="pointer-events-auto inline-flex min-h-11 items-center gap-1.5 rounded-full bg-night/85 px-3.5 text-sm backdrop-blur"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            Tonight
          </Link>
          <ul
            className="pointer-events-auto flex max-w-[65%] flex-wrap items-center justify-end gap-x-2.5 gap-y-1 rounded-2xl bg-night/85 px-3 py-2 text-xs backdrop-blur"
            aria-label="Tonight's view toward the sunset"
          >
            {LEGEND.map((view) => (
              <li key={view} className="flex items-center gap-1.5" title={VIEWS[view].label}>
                <span className="size-2 rounded-full" style={{ backgroundColor: VIEW_COLORS[view] }} aria-hidden="true" />
                {LEGEND_SHORT[view]}
              </li>
            ))}
          </ul>
        </div>
        <FilterChips
          filters={filters}
          onChange={setFilters}
          onSearch={() => setSearching(true)}
          placeName={place?.source === "search" ? place.name : undefined}
        />
      </header>

      <button
        type="button"
        onClick={recenter}
        className="absolute right-3 bottom-[calc(var(--sheet-h,0px)_+_7rem)] rounded-full bg-night/85 p-3 backdrop-blur transition-[bottom] duration-200"
        aria-label={place?.source === "search" ? "Back to the place you chose" : "Back to my location"}
      >
        <LocateFixed className="size-5" />
      </button>

      {zoomedOut && !selected && (
        <p className="absolute inset-x-0 bottom-[max(1.5rem,env(safe-area-inset-bottom))] mx-auto w-fit rounded-full bg-night/85 px-4 py-2 text-sm text-mist backdrop-blur">
          Zoom in to see spots
        </p>
      )}

      {selected && sun && index && (
        <div
          ref={setSheet}
          className="absolute inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-10 rounded-3xl border border-white/10 bg-night/95 p-4 shadow-2xl backdrop-blur"
        >
          <SpotSheet
            spot={selected}
            index={index}
            sunset={sun.sunset}
            bearing={sun.bearing}
            from={place}
            rank={rankOf.get(selected.id) ?? null}
            favorite={isFavorite(selected.id)}
            onToggleFavorite={() =>
              toggle({ id: selected.id, tile: tileKey(selected.lat, selected.lon, index.tile), name: selected.name })
            }
            onClose={() => setSelected(null)}
          />
        </div>
      )}

      {searching && (
        <PlaceSearch
          onClose={() => setSearching(false)}
          onUseDevice={() => {
            setSearching(false);
            setSelected(null);
            locate();
          }}
          onChoose={(next) => {
            setSearching(false);
            setSelected(null);
            choose(next);
            mapRef.current?.flyTo({ center: [next.lon, next.lat], zoom: 14 });
          }}
        />
      )}
    </main>
  );
}

function FilterChips({
  filters,
  onChange,
  onSearch,
  placeName,
}: {
  filters: MapFilters;
  onChange: (next: MapFilters) => void;
  onSearch: () => void;
  placeName?: string;
}) {
  const chip = (on: boolean) =>
    `pointer-events-auto inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-[13px] font-medium backdrop-blur ${
      on ? "border-[#ffc35c]/60 bg-[#3a2a12]/90 text-[#ffe2ad]" : "border-white/10 bg-night/85 text-ink"
    }`;
  const toggleKind = (id: MapFilters["kinds"][number]) =>
    onChange({ ...filters, kinds: filters.kinds.includes(id) ? filters.kinds.filter((k) => k !== id) : [...filters.kinds, id] });

  return (
    <div
      className="pointer-events-none -mx-3 flex gap-2 overflow-x-auto px-3 pb-1 [scrollbar-width:none]"
      role="group"
      aria-label="Find and filter spots"
    >
      <button type="button" onClick={onSearch} className={chip(Boolean(placeName))} aria-label={placeName ? `Place: ${placeName}. Change` : "Search for a place"}>
        <Search className="size-4" aria-hidden="true" />
        {placeName ? <span className="max-w-32 truncate">{placeName}</span> : "Place"}
      </button>
      <button
        type="button"
        aria-pressed={filters.openView}
        onClick={() => onChange({ ...filters, openView: !filters.openView })}
        className={chip(filters.openView)}
      >
        Sunset in view
      </button>
      <button
        type="button"
        aria-pressed={filters.openLate}
        onClick={() => onChange({ ...filters, openLate: !filters.openLate })}
        className={chip(filters.openLate)}
      >
        Open after dusk
      </button>
      {KIND_FILTERS.map((k) => (
        <button
          key={k.id}
          type="button"
          aria-pressed={filters.kinds.includes(k.id)}
          onClick={() => toggleKind(k.id)}
          className={chip(filters.kinds.includes(k.id))}
        >
          {k.label}
        </button>
      ))}
      {filtersActive(filters) && (
        <button
          type="button"
          onClick={() => onChange({ kinds: [], openView: false, openLate: false })}
          className="pointer-events-auto inline-flex min-h-11 shrink-0 items-center rounded-full bg-night/85 px-3.5 text-[13px] text-mist underline underline-offset-2 backdrop-blur"
        >
          Clear
        </button>
      )}
    </div>
  );
}

function SpotSheet({
  spot,
  index,
  sunset,
  bearing,
  from,
  rank,
  favorite,
  onToggleFavorite,
  onClose,
}: {
  spot: Spot;
  index: SpotIndex;
  sunset: Date;
  bearing: number;
  from: LatLon | null;
  rank: number | null;
  favorite: boolean;
  onToggleFavorite: () => void;
  onClose: () => void;
}) {
  const format = timeFormatter();
  const { view } = viewTonight(spot, bearing, index.profile);
  const hides = view && view !== "open" ? sunHidesAt(spot, sunset, index.profile) : null;
  const forecast = useMemo(() => readCachedForecast(spot), [spot]);
  const sameEvening = forecast !== null && Math.abs(Date.parse(forecast.sun.sunset) - sunset.getTime()) < 30 * 60_000;
  const details = [
    KIND_LABELS[spot.kind],
    from ? `${walkMinutes(from, spot)} min walk` : null,
    hides ? `sun hides at ${format(hides)}` : `sunset ${format(sunset)}`,
  ].filter(Boolean);
  const href = `/spots/${tileKey(spot.lat, spot.lon, index.tile)}/${spot.id}`;

  return (
    <>
      <div className="flex items-start gap-3">
        <ViewPostcard
          spot={spot}
          profile={index.profile}
          sunset={sunset}
          bearing={bearing}
          hidesAt={hides}
          sky={sameEvening ? skyPalette(forecast.look, "glow") : null}
          look={sameEvening ? forecast.look : null}
          thumb
          className="size-16 shrink-0"
        />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold tracking-[0.06em] uppercase" style={{ color: VIEW_COLORS[view ?? "unknown"] }}>
            {rank ? `No. ${rank} tonight · ` : ""}
            {view ? VIEWS[view].label : "View unknown"}
          </p>
          <h2 className="mt-0.5 text-[17px] leading-tight font-semibold">{spot.name}</h2>
          <p className="mt-0.5 text-sm text-mist">{details.join(" · ")}</p>
        </div>
        <div className="-mt-1 -mr-1 flex shrink-0">
          <button
            type="button"
            onClick={onToggleFavorite}
            aria-pressed={favorite}
            aria-label={favorite ? "Remove from favorites" : "Add to favorites"}
            className="rounded-full p-2.5 hover:bg-white/10"
          >
            <Star className={`size-5 ${favorite ? "fill-[#ffc35c] text-[#ffc35c]" : "text-mist"}`} />
          </button>
          <button type="button" onClick={onClose} className="rounded-full p-2.5 text-mist hover:bg-white/10" aria-label="Close">
            <X className="size-5" />
          </button>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Link href={href} className="flex min-h-11 items-center justify-center gap-1 rounded-full bg-white/10 text-sm font-medium hover:bg-white/15">
          Details
          <ChevronRight className="size-4" aria-hidden="true" />
        </Link>
        <a
          href={`https://www.google.com/maps/dir/?api=1&destination=${spot.lat},${spot.lon}&travelmode=walking`}
          className="flex min-h-11 items-center justify-center gap-1 rounded-full bg-ember text-sm font-semibold text-night hover:brightness-110"
        >
          Directions
          <ArrowUpRight className="size-4" aria-hidden="true" />
        </a>
      </div>
    </>
  );
}
