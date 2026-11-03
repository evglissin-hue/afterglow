"use client";

import { useCallback, useEffect, useState } from "react";

/** Where to show the forecast and spots for: the phone's location, central London, or a place searched for. */
export type Place = { lat: number; lon: number; source: "device" | "default" | "search"; name?: string };

export const CENTRAL_LONDON = { lat: 51.5072, lon: -0.1276 };
const PLACE_KEY = "afterglow:place";
const WALK_KEY = "afterglow:walk";
export const WALK_OPTIONS = [5, 10, 15, 30] as const;

function readStorage<T>(key: string): T | null {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null") as T | null;
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private mode or storage blocked: the app still works, it just forgets.
  }
}

/**
 * Where to show spots and the forecast for. Starts from the last place used; refreshes from the
 * device when the visitor shared their location before, and respects an earlier "central London".
 */
export function usePlace() {
  const [place, setPlaceState] = useState<Place | null>(null);

  const setPlace = useCallback((next: Place) => {
    setPlaceState(next);
    writeStorage(PLACE_KEY, next);
  }, []);

  const locate = useCallback(() => {
    const fallback = () => setPlace({ ...CENTRAL_LONDON, source: "default" });
    if (!("geolocation" in navigator)) {
      fallback();
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => setPlace({ lat: pos.coords.latitude, lon: pos.coords.longitude, source: "device" }),
      fallback,
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 10 * 60_000 },
    );
  }, [setPlace]);

  useEffect(() => {
    const id = setTimeout(() => {
      const saved = readStorage<Place>(PLACE_KEY);
      if (saved) setPlaceState(saved);
      if (!saved || saved.source === "device") locate();
    }, 0);
    return () => clearTimeout(id);
  }, [locate]);

  const chooseLondon = useCallback(() => setPlace({ ...CENTRAL_LONDON, source: "default" }), [setPlace]);
  return { place, locate, chooseLondon, choose: setPlace };
}

/** How far the visitor is happy to walk, in minutes. */
export function useWalkMinutes(): [number, (minutes: number) => void] {
  const [minutes, setMinutes] = useState(15);
  useEffect(() => {
    const id = setTimeout(() => {
      const saved = readStorage<number>(WALK_KEY);
      if (saved && (WALK_OPTIONS as readonly number[]).includes(saved)) setMinutes(saved);
    }, 0);
    return () => clearTimeout(id);
  }, []);
  const update = useCallback((next: number) => {
    setMinutes(next);
    writeStorage(WALK_KEY, next);
  }, []);
  return [minutes, update];
}

/** Straight-line distance that a walk of `minutes` covers, with a little slack. */
export const walkRadiusKm = (minutes: number) => ((minutes / 60) * 5) / 1.3 + 0.2;
