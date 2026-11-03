"use client";

import Link from "next/link";
import { ChevronRight, Map as MapIcon } from "lucide-react";
import type { Forecast } from "@/lib/forecast/getForecast";
import { KIND_LABELS, VIEWS, leaveBy, rankSpots, sunHidesAt, tileKey, type RankedSpot, type SpotIndex } from "@/lib/spots";
import { ACCESS_TEXT, VIEW_COLORS, timeFormatter } from "./spotStyle";
import { WALK_OPTIONS, useWalkMinutes, walkRadiusKm, type Place } from "./usePlace";
import { useSpotsNear } from "./useSpots";

export function BestNearYou({ place, forecast, now }: { place: Place; forecast: Forecast; now: Date | null }) {
  const [walk, setWalk] = useWalkMinutes();
  const loaded = useSpotsNear(place, walkRadiusKm(walk));
  const format = timeFormatter(forecast.location.timezone);
  const sunset = new Date(forecast.sun.sunset);
  const where = place.source === "device" ? "you" : "central London";

  let body: React.ReactNode;
  if (!loaded) {
    body = <p className="py-3 text-sm text-mist">Looking for spots…</p>;
  } else if (loaded.error || !loaded.spots || !loaded.index) {
    body = <p className="py-3 text-sm text-mist">Couldn&apos;t load spots right now.</p>;
  } else {
    const ranked = rankSpots(loaded.spots, place, forecast.sun.bearing, walk, loaded.index.profile).slice(0, 3);
    body = ranked.length ? (
      <ul className="mt-1 divide-y divide-white/10">
        {ranked.map((r) => (
          <SpotRow key={r.spot.id} ranked={r} index={loaded.index!} sunset={sunset} now={now} format={format} />
        ))}
      </ul>
    ) : (
      <p className="py-3 text-sm text-mist">
        No spots within a {walk}-minute walk. Try a longer walk. Spots only cover London so far.
      </p>
    );
  }

  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-4" aria-labelledby="best-near">
      <div className="flex items-center justify-between gap-3">
        <h2 id="best-near" className="text-sm font-medium text-mist">
          Best near {where}
        </h2>
        <div className="flex rounded-full border border-white/10 p-0.5 text-xs" role="group" aria-label="Walking time">
          {WALK_OPTIONS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setWalk(option)}
              aria-pressed={walk === option}
              className={`rounded-full px-2.5 py-1 tabular-nums ${
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
      <Link
        href="/map"
        className="mt-2 inline-flex items-center gap-1.5 text-sm text-mist underline-offset-2 hover:text-ink hover:underline"
      >
        <MapIcon className="size-4" aria-hidden="true" />
        All spots on the map
      </Link>
    </section>
  );
}

function SpotRow({
  ranked,
  index,
  sunset,
  now,
  format,
}: {
  ranked: RankedSpot;
  index: SpotIndex;
  sunset: Date;
  now: Date | null;
  format: (date: Date) => string;
}) {
  const { spot, walk, view } = ranked;
  const hides = view && view !== "open" ? sunHidesAt(spot, sunset, index.profile) : null;
  const leave = leaveBy(sunset, walk);
  const late = now !== null && now > leave;
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
        <span
          className="size-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: VIEW_COLORS[view ?? "unknown"] }}
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          <p className="font-medium leading-snug">{spot.name}</p>
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
