"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AddLayerObject, GeoJSONSource, Map as MapLibreMap, MapMouseEvent, PointLike } from "maplibre-gl";
import { ArrowLeft, ChevronRight, LocateFixed, X } from "lucide-react";
import { destination, distanceKm, type LatLon } from "@/lib/geo";
import { nextSunset } from "@/lib/sun";
import {
  KIND_LABELS,
  VIEWS,
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
import { VIEW_COLORS, timeFormatter } from "./spotStyle";
import { useWalkMinutes, usePlace, walkRadiusKm } from "./usePlace";

const STYLE_URL = "https://tiles.openfreemap.org/styles/dark";
const MIN_ZOOM_FOR_SPOTS = 11.5;
const LEGEND: View[] = ["open", "low", "sky", "blocked"];

/**
 * How far from a pin a tap still picks it, in px. A fingertip covers about 45 px, far more than a pin,
 * so a tap picks the nearest pin within reach instead of needing to land on the dot itself.
 */
const HIT_RADIUS = { touch: 28, mouse: 14 };
/** Space the header takes at the top of the map, px. */
const HEADER_SPACE = 110;

/** Better views draw on top of worse ones where pins overlap. */
const VIEW_RANK: Record<View | "unknown", number> = { open: 4, low: 3, sky: 2, unknown: 1, blocked: 0 };

type CirclePaint = NonNullable<Extract<AddLayerObject, { type: "circle" }>["paint"]>;

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

function circle(center: LatLon, radiusKm: number): FeatureCollection {
  const ring = Array.from({ length: 65 }, (_, i) => {
    const p = destination(center, (i * 360) / 64, radiusKm);
    return [p.lon, p.lat];
  });
  return { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [ring] } }] };
}

function sunsetLine(from: LatLon, bearing: number): FeatureCollection {
  const to = destination(from, bearing, 1.2);
  return {
    type: "FeatureCollection",
    features: [
      { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [[from.lon, from.lat], [to.lon, to.lat]] } },
    ],
  };
}

const EMPTY: FeatureCollection = { type: "FeatureCollection", features: [] };

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
  const { place, locate } = usePlace();
  const [walk] = useWalkMinutes();
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const tiles = useRef(new Map<string, Spot[]>());
  const [ready, setReady] = useState(false);
  const [index, setIndex] = useState<SpotIndex | null>(null);
  const [spots, setSpots] = useState<Spot[]>([]);
  const [zoomedOut, setZoomedOut] = useState(false);
  const [selected, setSelected] = useState<Spot | null>(null);
  const [sheet, setSheet] = useState<HTMLDivElement | null>(null);

  const sun = useMemo(() => (place ? nextSunset(new Date(), place.lat, place.lon) : null), [place]);

  // Create the map once we know where to centre it.
  useEffect(() => {
    if (!place || mapRef.current || !container.current) return;
    let cancelled = false;
    import("maplibre-gl").then((maplibregl) => {
      if (cancelled || !container.current || mapRef.current) return;
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
        map.addLayer({ id: "walk-fill", type: "fill", source: "walk", paint: { "fill-color": "#f08a3c", "fill-opacity": 0.06 } });
        map.addLayer({
          id: "walk-line",
          type: "line",
          source: "walk",
          paint: { "line-color": "#f08a3c", "line-opacity": 0.5, "line-width": 1.5, "line-dasharray": [2, 2] },
        });
        map.addSource("sunset", { type: "geojson", data: EMPTY });
        map.addLayer({
          id: "sunset-line",
          type: "line",
          source: "sunset",
          paint: { "line-color": "#ffc35c", "line-width": 2.5, "line-dasharray": [1, 1.5] },
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
            "circle-stroke-color": "#0d0b14",
            "circle-stroke-width": 2,
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

  // Load the tiles covering the visible area after each move.
  const loadVisible = useCallback(async () => {
    const map = mapRef.current;
    if (!map || !index) return;
    if (map.getZoom() < MIN_ZOOM_FOR_SPOTS) {
      setZoomedOut(true);
      return;
    }
    setZoomedOut(false);
    const center = map.getCenter();
    const corner = map.getBounds().getNorthEast();
    const radius = distanceKm({ lat: center.lat, lon: center.lng }, { lat: corner.lat, lon: corner.lng });
    const missing = tilesAround({ lat: center.lat, lon: center.lng }, radius, index).filter((k) => !tiles.current.has(k));
    if (!missing.length) return;
    await Promise.all(
      missing.map(async (key) => {
        const response = await fetch(`/data/spots/${key}.json`);
        tiles.current.set(key, response.ok ? ((await response.json()) as { spots: Spot[] }).spots : []);
      }),
    );
    setSpots([...tiles.current.values()].flat());
  }, [index]);

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
      if (!showTonight(spot, view)) return [];
      return [
        {
          type: "Feature" as const,
          properties: {
            id: spot.id,
            color: VIEW_COLORS[view ?? "unknown"],
            rank: VIEW_RANK[view ?? "unknown"],
            good: view === "open" || view === "low",
          },
          geometry: { type: "Point" as const, coordinates: [spot.lon, spot.lat] },
        },
      ];
    });
    (map.getSource("spots") as GeoJSONSource).setData({ type: "FeatureCollection", features });
  }, [ready, spots, sun, index]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !place) return;
    (map.getSource("walk") as GeoJSONSource).setData(circle(place, walkRadiusKm(walk)));
    (map.getSource("me") as GeoJSONSource).setData({
      type: "FeatureCollection",
      features: [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [place.lon, place.lat] } }],
    });
  }, [ready, place, walk]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !sun) return;
    const from = selected ?? place;
    (map.getSource("sunset") as GeoJSONSource).setData(from ? sunsetLine(from, sun.bearing) : EMPTY);
  }, [ready, selected, place, sun]);

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
    locate();
    if (place) mapRef.current?.flyTo({ center: [place.lon, place.lat], zoom: 14 });
  };

  return (
    <main className="spot-map relative h-dvh w-full">
      <div className="absolute inset-0">
        <div ref={container} className="h-full w-full" />
      </div>

      <header className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <Link
          href="/"
          className="pointer-events-auto inline-flex items-center gap-1.5 rounded-full bg-night/85 px-3 py-2 text-sm backdrop-blur"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Tonight
        </Link>
        <div className="pointer-events-auto rounded-2xl bg-night/85 px-3 py-2 text-xs backdrop-blur">
          <p className="mb-1 text-dusk">Tonight&apos;s view toward the sunset</p>
          <ul className="grid grid-cols-2 gap-x-3 gap-y-1">
            {LEGEND.map((view) => (
              <li key={view} className="flex items-center gap-1.5">
                <span className="size-2 rounded-full" style={{ backgroundColor: VIEW_COLORS[view] }} aria-hidden="true" />
                {VIEWS[view].label}
              </li>
            ))}
          </ul>
        </div>
      </header>

      <button
        type="button"
        onClick={recenter}
        className="absolute right-3 bottom-[calc(var(--sheet-h,0px)_+_7rem)] rounded-full bg-night/85 p-2.5 backdrop-blur transition-[bottom] duration-200"
        aria-label="Back to my location"
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
            onClose={() => setSelected(null)}
          />
        </div>
      )}
    </main>
  );
}

function SpotSheet({
  spot,
  index,
  sunset,
  bearing,
  from,
  onClose,
}: {
  spot: Spot;
  index: SpotIndex;
  sunset: Date;
  bearing: number;
  from: LatLon | null;
  onClose: () => void;
}) {
  const format = timeFormatter();
  const { view } = viewTonight(spot, bearing, index.profile);
  const hides = view && view !== "open" ? sunHidesAt(spot, sunset, index.profile) : null;
  const details = [
    KIND_LABELS[spot.kind],
    from ? `${walkMinutes(from, spot)} min walk` : null,
    hides ? `sun hides at ${format(hides)}` : `sunset ${format(sunset)}`,
  ].filter(Boolean);

  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-medium">
            <span className="size-2.5 rounded-full" style={{ backgroundColor: VIEW_COLORS[view ?? "unknown"] }} aria-hidden="true" />
            {view ? VIEWS[view].label : "View unknown"} tonight
          </p>
          <h2 className="mt-1 text-lg leading-tight font-semibold">{spot.name}</h2>
          <p className="mt-0.5 text-sm text-mist">{details.join(" · ")}</p>
        </div>
        <button type="button" onClick={onClose} className="-m-1 rounded-full p-2.5 text-mist hover:bg-white/10" aria-label="Close">
          <X className="size-5" />
        </button>
      </div>
      <Link
        href={`/spots/${tileKey(spot.lat, spot.lon, index.tile)}/${spot.id}`}
        className="mt-3 flex items-center justify-center gap-1 rounded-full bg-white/10 py-3 text-sm font-medium hover:bg-white/15"
      >
        View and season details
        <ChevronRight className="size-4" aria-hidden="true" />
      </Link>
    </>
  );
}
