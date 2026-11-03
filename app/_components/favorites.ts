"use client";

import { useCallback, useEffect, useState } from "react";

/** A starred spot. `tile` finds its data file; `name` shows it without loading anything. */
export interface Favorite {
  id: string;
  tile: string;
  name: string;
}

const KEY = "afterglow:favorites";
const CHANGED = "afterglow:favorites";

export function readFavorites(): Favorite[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(value) ? value.filter((f): f is Favorite => typeof f?.id === "string" && typeof f?.tile === "string") : [];
  } catch {
    return [];
  }
}

function writeFavorites(favorites: Favorite[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(favorites));
  } catch {
    // Storage blocked: the star works until the page closes.
  }
  window.dispatchEvent(new Event(CHANGED));
}

/** Spots starred on this device, kept in step across components and tabs. */
export function useFavorites() {
  const [favorites, setFavorites] = useState<Favorite[]>([]);

  useEffect(() => {
    const sync = () => setFavorites(readFavorites());
    const first = setTimeout(sync, 0);
    const fromOtherTab = (event: StorageEvent) => event.key === KEY && sync();
    window.addEventListener(CHANGED, sync);
    window.addEventListener("storage", fromOtherTab);
    return () => {
      clearTimeout(first);
      window.removeEventListener(CHANGED, sync);
      window.removeEventListener("storage", fromOtherTab);
    };
  }, []);

  const toggle = useCallback((spot: Favorite) => {
    const current = readFavorites();
    const next = current.some((f) => f.id === spot.id)
      ? current.filter((f) => f.id !== spot.id)
      : [...current, { id: spot.id, tile: spot.tile, name: spot.name }];
    setFavorites(next);
    writeFavorites(next);
  }, []);

  const isFavorite = useCallback((id: string) => favorites.some((f) => f.id === id), [favorites]);
  return { favorites, isFavorite, toggle };
}
