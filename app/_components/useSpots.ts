"use client";

import { useEffect, useState } from "react";
import type { LatLon } from "@/lib/geo";
import { loadSpotsNear, type Spot, type SpotIndex } from "@/lib/spots";

type Loaded = { key: string; index?: SpotIndex; spots?: Spot[]; error?: string };

/** Spots within `radiusKm` of a point, loaded from the static tiles in /public/data/spots. */
export function useSpotsNear(center: LatLon | null, radiusKm: number) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const key = center ? `${center.lat.toFixed(3)},${center.lon.toFixed(3)},${radiusKm.toFixed(1)}` : null;

  useEffect(() => {
    if (!center || !key) return;
    let cancelled = false;
    loadSpotsNear(center, radiusKm).then(
      ({ index, spots }) => !cancelled && setLoaded({ key, index, spots }),
      (error: unknown) => !cancelled && setLoaded({ key, error: error instanceof Error ? error.message : String(error) }),
    );
    return () => {
      cancelled = true;
    };
  }, [center, radiusKm, key]);

  return loaded && loaded.key === key ? loaded : null;
}
