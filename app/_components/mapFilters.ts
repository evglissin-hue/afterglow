"use client";

import { useCallback, useEffect, useState } from "react";
import type { Spot, SpotKind, View } from "@/lib/spots";

/** Kinds of spot a filter chip can pick; "high" covers rooftops and viewpoints. */
export type KindFilter = "park" | "water" | "bridge" | "street" | "high";

export interface MapFilters {
  /** Show only these kinds; none picked means every kind. */
  kinds: KindFilter[];
  /** Only spots where the sun sets in view or nearly (open horizon or low skyline) tonight. */
  openView: boolean;
  /** Hide spots that close at dusk. */
  openLate: boolean;
}

export const KIND_FILTERS: { id: KindFilter; label: string }[] = [
  { id: "park", label: "Parks" },
  { id: "water", label: "Water" },
  { id: "bridge", label: "Bridges" },
  { id: "street", label: "Streets" },
  { id: "high", label: "Rooftops" },
];

const KEY = "afterglow:map-filters";
const NONE: MapFilters = { kinds: [], openView: false, openLate: false };

const kindFilter = (kind: SpotKind): KindFilter => (kind === "rooftop" || kind === "viewpoint" ? "high" : kind);

export function passesFilters(spot: Spot, view: View | null, filters: MapFilters): boolean {
  if (filters.kinds.length && !filters.kinds.includes(kindFilter(spot.kind))) return false;
  if (filters.openView && view !== "open" && view !== "low") return false;
  if (filters.openLate && spot.access === "dusk") return false;
  return true;
}

export const filtersActive = (f: MapFilters) => f.kinds.length > 0 || f.openView || f.openLate;

/** The map's filter chips, remembered on this device. */
export function useMapFilters(): [MapFilters, (next: MapFilters) => void] {
  const [filters, setFilters] = useState<MapFilters>(NONE);
  useEffect(() => {
    const id = setTimeout(() => {
      try {
        const saved = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<MapFilters> | null;
        if (saved) setFilters({ ...NONE, ...saved, kinds: Array.isArray(saved.kinds) ? saved.kinds : [] });
      } catch {
        // Nothing saved, or storage blocked.
      }
    }, 0);
    return () => clearTimeout(id);
  }, []);
  const update = useCallback((next: MapFilters) => {
    setFilters(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      // Storage blocked: the filters last until the page closes.
    }
  }, []);
  return [filters, update];
}
