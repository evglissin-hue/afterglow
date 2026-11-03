"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ChevronRight, Map as MapIcon, Star } from "lucide-react";
import type { Forecast } from "@/lib/forecast/getForecast";
import { sunEvents } from "@/lib/sun";
import {
  KIND_LABELS,
  VIEWS,
  leaveBy,
  rankSpots,
  sunHidesAt,
  tileKey,
  viewTonight,
  walkMinutes,
  type RankedSpot,
  type Spot,
  type SpotIndex,
} from "@/lib/spots";
import { useFavorites, type Favorite } from "./favorites";
import { ACCESS_TEXT, VIEW_COLORS, timeFormatter } from "./spotStyle";
import { WALK_OPTIONS, useWalkMinutes, walkRadiusKm, type Place } from "./usePlace";
import { useSpotsNear } from "./useSpots";

const VIEW_ORDER = { open: 0, low: 1, sky: 2, blocked: 3 } as const;

export function BestNearYou({ place, forecast, now }: { place: Place; forecast: Forecast; now: Date | null }) {
  const [walk, setWalk] = useWalkMinutes();
  const loaded = useSpotsNear(place, walkRadiusKm(walk));
  const { favorites } = useFavorites();
  const favoriteSpots = useFavoriteSpots(favorites);
  const format = timeFormatter(forecast.location.timezone);
  const sunset = new Date(forecast.sun.sunset);
  // The exact direction from this place (the forecast's is rounded, for a 0.1° grid), so the order
  // matches the numbers on the map.
  const bearing = useMemo(
    () => sunEvents(new Date(forecast.sun.sunset), place.lat, place.lon)?.bearing ?? forecast.sun.bearing,
    [forecast.sun.sunset, forecast.sun.bearing, place.lat, place.lon],
  );
  const where = place.source === "device" ? "you" : place.source === "search" && place.name ? place.name : "central London";

  let body: React.ReactNode;
  if (!loaded) {
    body = <p className="py-3 text-sm text-mist">Looking for spots…</p>;
  } else if (loaded.error || !loaded.spots || !loaded.index) {
    body = <p className="py-3 text-sm text-mist">Couldn&apos;t load spots right now.</p>;
  } else {
    const ranked = rankSpots(loaded.spots, place, bearing, walk, loaded.index.profile).slice(0, 3);
    body = ranked.length ? (
      <ul className="mt-1 divide-y divide-white/10">
        {ranked.map((r, i) => (
          <SpotRow key={r.spot.id} ranked={r} badge={i + 1} index={loaded.index!} sunset={sunset} now={now} format={format} />
        ))}
      </ul>
    ) : (
      <p className="py-3 text-sm text-mist">
        No spots within a {walk}-minute walk. Try a longer walk. Spots only cover London so far.
      </p>
    );
  }

  const favoriteRows =
    loaded?.index && favoriteSpots.length
      ? favoriteSpots
          .map(({ spot }) => ({ spot, walk: walkMinutes(place, spot), ...viewTonight(spot, bearing, loaded.index!.profile) }))
          .sort((a, b) => (a.view ? VIEW_ORDER[a.view] : 4) - (b.view ? VIEW_ORDER[b.view] : 4) || a.walk - b.walk)
      : [];

  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-4" aria-labelledby="best-near">
      <div className="flex items-center justify-between gap-3">
        <h2 id="best-near" className="min-w-0 truncate text-sm font-medium text-mist">
          Best near {where}
        </h2>
        <div className="flex shrink-0 rounded-full border border-white/10 p-0.5 text-xs" role="group" aria-label="Walking time">
          {WALK_OPTIONS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setWalk(option)}
              aria-pressed={walk === option}
              className={`min-h-9 rounded-full px-2.5 tabular-nums ${
                walk === option ? "bg-white/15 text-ink" : "text-mist hover:text-ink"
              }`}
            >
              {option}
              {option === WALK_OPTIONS[WALK_OPTIONS.length - 1] ? " min" : ""}
            </button>
          ))}
        </div>
      </div>
      {body}
      {favoriteRows.length > 0 && loaded?.index && (
        <>
          <h3 className="mt-3 flex items-center gap-1.5 text-sm font-medium text-mist">
            <Star className="size-3.5 fill-[#ffc35c] text-[#ffc35c]" aria-hidden="true" />
            Your favorites
          </h3>
          <ul className="mt-1 divide-y divide-white/10">
            {favoriteRows.map((r) => (
              <SpotRow key={r.spot.id} ranked={r} index={loaded.index!} sunset={sunset} now={now} format={format} />
            ))}
          </ul>
        </>
      )}
      <Link
        href="/map"
        className="mt-2 inline-flex min-h-11 items-center gap-1.5 text-sm text-mist underline-offset-2 hover:text-ink hover:underline"
      >
        <MapIcon className="size-4" aria-hidden="true" />
        All spots on the map
      </Link>
    </section>
  );
}

/** Tile files already fetched, shared across renders. */
const tileCache = new Map<string, Promise<Spot[]>>();
const loadTile = (key: string) => {
  if (!tileCache.has(key)) {
    tileCache.set(
      key,
      fetch(`/data/spots/${encodeURIComponent(key)}.json`)
        .then((r) => (r.ok ? (r.json() as Promise<{ spots: Spot[] }>) : { spots: [] }))
        .then((d) => d.spots)
        .catch(() => {
          tileCache.delete(key);
          return [];
        }),
    );
  }
  return tileCache.get(key)!;
};

/** The starred spots' full data, loaded from their tiles. */
function useFavoriteSpots(favorites: Favorite[]) {
  const [found, setFound] = useState<{ key: string; spots: { spot: Spot; tile: string }[] }>({ key: "", spots: [] });
  const key = favorites.map((f) => f.id).join(",");
  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    Promise.all(
      favorites.map(async (f) => {
        const spot = (await loadTile(f.tile)).find((s) => s.id === f.id);
        return spot ? [{ spot, tile: f.tile }] : [];
      }),
    ).then((lists) => !cancelled && setFound({ key, spots: lists.flat() }));
    return () => {
      cancelled = true;
    };
  }, [key, favorites]);
  return key && found.key === key ? found.spots : [];
}

function SpotRow({
  ranked,
  badge,
  index,
  sunset,
  now,
  format,
}: {
  ranked: RankedSpot;
  /** Its place in tonight's top 3, matching the numbers on the map. */
  badge?: number;
  index: SpotIndex;
  sunset: Date;
  now: Date | null;
  format: (date: Date) => string;
}) {
  const { spot, walk, view } = ranked;
  const hides = view && view !== "open" ? sunHidesAt(spot, sunset, index.profile) : null;
  const leave = leaveBy(sunset, walk);
  const late = now !== null && now > leave;
  const color = VIEW_COLORS[view ?? "unknown"];
  const details = [
    KIND_LABELS[spot.kind],
    `${walk} min walk`,
    view ? VIEWS[view].label : "View unknown",
    hides ? `sun hides at ${format(hides)}` : null,
    spot.access ? ACCESS_TEXT[spot.access] : null,
  ].filter(Boolean);

  return (
    <li>
      <Link
        href={`/spots/${tileKey(spot.lat, spot.lon, index.tile)}/${spot.id}`}
        className="flex items-center gap-3 py-3 hover:bg-white/[0.03]"
      >
        {badge ? (
          <span
            className="grid size-6.5 shrink-0 place-items-center rounded-full text-[13px] font-semibold text-[#1a1320]"
            style={{ backgroundColor: color, boxShadow: view === "open" || view === "low" ? `0 0 12px ${color}99` : undefined }}
            aria-label={`Number ${badge}`}
          >
            {badge}
          </span>
        ) : (
          <span className="grid size-6.5 shrink-0 place-items-center" aria-hidden="true">
            <span className="size-2.5 rounded-full" style={{ backgroundColor: color }} />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="leading-snug font-medium">{spot.name}</p>
          <p className="text-xs leading-relaxed text-mist">{details.join(" · ")}</p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-[11px] text-dusk">{late ? "Leave" : "Leave by"}</p>
          <p className="font-semibold tabular-nums">{late ? "now" : format(leave)}</p>
        </div>
        <ChevronRight className="size-4 shrink-0 text-dusk" aria-hidden="true" />
      </Link>
    </li>
  );
}
