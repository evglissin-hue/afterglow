"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
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
        map.addLayer({
          id: "spots",
          type: "circle",
          source: "spots",
          paint: {
            "circle-color": ["get", "color"],
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 3, 14, 6, 17, 10],
            "circle-stroke-color": "#0d0b14",
            "circle-stroke-width": 1.5,
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
      map.on("click", "spots", (event) => {
        const id = event.features?.[0]?.properties?.id as string | undefined;
        const spot = [...tiles.current.values()].flat().find((s) => s.id === id);
        if (spot) setSelected(spot);
      });
      map.on("mouseenter", "spots", () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", "spots", () => (map.getCanvas().style.cursor = ""));
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
          properties: { id: spot.id, color: VIEW_COLORS[view ?? "unknown"] },
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

  const recenter = () => {
    locate();
    if (place) mapRef.current?.flyTo({ center: [place.lon, place.lat], zoom: 14 });
  };

  return (
    <main className="relative h-dvh w-full">
      <div className="absolute inset-0">
        <div ref={container} className="h-full w-full" />
      </div>

      <header className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-3">
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
        className="absolute bottom-28 right-3 rounded-full bg-night/85 p-2.5 backdrop-blur"
        aria-label="Back to my location"
      >
        <LocateFixed className="size-5" />
      </button>

      {zoomedOut && !selected && (
        <p className="absolute inset-x-0 bottom-6 mx-auto w-fit rounded-full bg-night/85 px-4 py-2 text-sm text-mist backdrop-blur">
          Zoom in to see spots
        </p>
      )}

      {selected && sun && index && (
        <SpotSheet spot={selected} index={index} sunset={sun.sunset} bearing={sun.bearing} from={place} onClose={() => setSelected(null)} />
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
    <div className="absolute inset-x-3 bottom-3 rounded-3xl border border-white/10 bg-night/95 p-4 shadow-2xl backdrop-blur">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-medium">
            <span className="size-2.5 rounded-full" style={{ backgroundColor: VIEW_COLORS[view ?? "unknown"] }} aria-hidden="true" />
            {view ? VIEWS[view].label : "View unknown"} tonight
          </p>
          <h2 className="mt-1 text-lg leading-tight font-semibold">{spot.name}</h2>
          <p className="mt-0.5 text-sm text-mist">{details.join(" · ")}</p>
        </div>
        <button type="button" onClick={onClose} className="rounded-full p-1.5 text-mist hover:bg-white/10" aria-label="Close">
          <X className="size-5" />
        </button>
      </div>
      <Link
        href={`/spots/${tileKey(spot.lat, spot.lon, index.tile)}/${spot.id}`}
        className="mt-3 flex items-center justify-center gap-1 rounded-full bg-white/10 py-2.5 text-sm font-medium hover:bg-white/15"
      >
        View and season details
        <ChevronRight className="size-4" aria-hidden="true" />
      </Link>
    </div>
  );
}
