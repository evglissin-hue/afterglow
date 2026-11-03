"use client";

import { useEffect, useId, useState } from "react";
import { LocateFixed, MapPin, Search, X } from "lucide-react";
import type { Place } from "./usePlace";

interface Result {
  key: string;
  name: string;
  detail: string;
  lat: number;
  lon: number;
}

interface PhotonFeature {
  geometry: { coordinates: [number, number] };
  properties: {
    osm_id?: number;
    name?: string;
    street?: string;
    housenumber?: string;
    postcode?: string;
    district?: string;
    city?: string;
    county?: string;
  };
}

/** Places matching `query`, nearest London first, from Photon (komoot's free OpenStreetMap geocoder). */
async function searchPlaces(query: string, signal: AbortSignal): Promise<Result[]> {
  const params = new URLSearchParams({ q: query, limit: "7", lang: "en", lat: "51.507", lon: "-0.128" });
  const response = await fetch(`https://photon.komoot.io/api/?${params}`, { signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const { features } = (await response.json()) as { features: PhotonFeature[] };
  const seen = new Set<string>();
  return features.flatMap((f) => {
    const p = f.properties;
    const name = p.name || [p.housenumber, p.street].filter(Boolean).join(" ") || p.postcode;
    if (!name) return [];
    const detail = [p.name ? p.street : null, p.district, p.city ?? p.county].filter(Boolean).join(", ");
    const key = `${name}|${detail}`;
    if (seen.has(key)) return [];
    seen.add(key);
    const [lon, lat] = f.geometry.coordinates;
    return [{ key, name, detail, lat, lon }];
  });
}

/** A full-screen place picker: search a place, or go back to the phone's location. */
export function PlaceSearch({
  onChoose,
  onUseDevice,
  onClose,
}: {
  onChoose: (place: Place) => void;
  onUseDevice: () => void;
  onClose: () => void;
}) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [state, setState] = useState<{ query: string; results?: Result[]; error?: boolean } | null>(null);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      searchPlaces(q, controller.signal).then(
        (results) => setState({ query: q, results }),
        (error: unknown) => !controller.signal.aborted && setState({ query: q, error: Boolean(error) }),
      );
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  const q = query.trim();
  const current = state && state.query === q ? state : null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={`${id}-title`}
      className="fixed inset-0 z-50 overflow-y-auto bg-night/97 backdrop-blur"
      onKeyDown={(event) => event.key === "Escape" && onClose()}
    >
      <div className="mx-auto max-w-md px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-10">
        <h2 id={`${id}-title`} className="sr-only">
          Choose a place
        </h2>
        <div className="flex items-center gap-2">
          <label className="flex min-h-12 flex-1 items-center gap-2 rounded-full border border-white/15 bg-white/[0.06] px-4 focus-within:border-ember/70">
            <Search className="size-4 shrink-0 text-mist" aria-hidden="true" />
            <span className="sr-only">Search for a place</span>
            <input
              autoFocus
              type="search"
              enterKeyHint="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="A park, street, station or postcode"
              className="min-w-0 flex-1 bg-transparent text-base text-ink outline-none placeholder:text-dusk"
            />
          </label>
          <button type="button" onClick={onClose} className="min-h-12 rounded-full px-3 text-sm text-mist hover:text-ink" aria-label="Close">
            <X className="size-5" />
          </button>
        </div>

        <ul className="mt-3 divide-y divide-white/10">
          <li>
            <button
              type="button"
              onClick={onUseDevice}
              className="flex min-h-14 w-full items-center gap-3 text-left text-ink hover:bg-white/[0.03]"
            >
              <LocateFixed className="size-5 shrink-0 text-[#5aa9ff]" aria-hidden="true" />
              Use my location
            </button>
          </li>
          {current?.results?.map((result) => (
            <li key={result.key}>
              <button
                type="button"
                onClick={() => onChoose({ lat: result.lat, lon: result.lon, source: "search", name: result.name })}
                className="flex min-h-14 w-full items-center gap-3 py-2 text-left hover:bg-white/[0.03]"
              >
                <MapPin className="size-5 shrink-0 text-ember" aria-hidden="true" />
                <span className="min-w-0">
                  <span className="block truncate text-ink">{result.name}</span>
                  {result.detail && <span className="block truncate text-sm text-mist">{result.detail}</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-sm text-mist" aria-live="polite">
          {q.length < 2
            ? ""
            : !current
              ? "Searching…"
              : current.error
                ? "Couldn't search right now. Check your connection."
                : current.results?.length
                  ? ""
                  : "No places found."}
        </p>
        <p className="mt-6 text-xs leading-relaxed text-dusk">
          Search by Photon (komoot), with OpenStreetMap data. What you type is sent to it. Spots only cover London so
          far; the forecast works anywhere.
        </p>
      </div>
    </div>
  );
}
