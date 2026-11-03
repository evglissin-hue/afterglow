"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowUpRight, Footprints, Star } from "lucide-react";
import { getPosition } from "suncalc";
import type { Forecast } from "@/lib/forecast/getForecast";
import { nextSunset } from "@/lib/sun";
import { compassPoint } from "@/lib/geo";
import {
  DEFAULT_PROFILE,
  KIND_LABELS,
  VIEWS,
  hengeDays,
  sunHidesAt,
  upcomingHenges,
  viewByMonth,
  viewTonight,
  walkMinutes,
  type Spot,
  type SpotIndex,
} from "@/lib/spots";
import { useFavorites } from "./favorites";
import { readCachedForecast } from "./forecastCache";
import { ProfileChart, type SunPoint } from "./ProfileChart";
import { skyPalette } from "./sky";
import { ACCESS_TEXT, VIEW_COLORS, timeFormatter } from "./spotStyle";
import { usePlace } from "./usePlace";
import { ViewPostcard } from "./ViewPostcard";

type Loaded = { spot?: Spot; index?: SpotIndex; forecast?: Forecast | null; error?: string };
const MONTHS = "JFMAMJJASOND".split("");
const MONTH_NAMES = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" ");

export default function SpotDetails({ tile, id }: { tile: string; id: string }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [now, setNow] = useState<Date | null>(null);
  const { place } = usePlace();

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch("/data/spots/index.json").then((r) => r.json() as Promise<SpotIndex>),
      fetch(`/data/spots/${encodeURIComponent(tile)}.json`).then((r) => (r.ok ? r.json() : { spots: [] })),
    ]).then(
      ([index, data]: [SpotIndex, { spots: Spot[] }]) => {
        if (cancelled) return;
        const spot = data.spots.find((s) => s.id === id);
        setLoaded(spot ? { spot, index, forecast: readCachedForecast(spot) } : { error: "This spot doesn't exist any more." });
        setNow(new Date());
      },
      () => !cancelled && setLoaded({ error: "Couldn't load this spot." }),
    );
    return () => {
      cancelled = true;
    };
  }, [tile, id]);

  return (
    <main className="mx-auto w-full max-w-md px-4 pt-[max(1.25rem,env(safe-area-inset-top))] pb-14">
      <Link href="/map" className="inline-flex min-h-11 items-center gap-1.5 text-sm text-mist hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden="true" />
        Map
      </Link>
      {!loaded || !now ? (
        <p className="mt-8 text-mist">Loading…</p>
      ) : loaded.error || !loaded.spot || !loaded.index ? (
        <p className="mt-8 text-mist">{loaded.error}</p>
      ) : (
        <SpotView spot={loaded.spot} tile={tile} index={loaded.index} forecast={loaded.forecast ?? null} now={now} from={place} />
      )}
    </main>
  );
}

function SpotView({
  spot,
  tile,
  index,
  forecast,
  now,
  from,
}: {
  spot: Spot;
  tile: string;
  index: SpotIndex;
  forecast: Forecast | null;
  now: Date;
  from: { lat: number; lon: number } | null;
}) {
  const profile = index.profile ?? DEFAULT_PROFILE;
  const format = timeFormatter();
  const { isFavorite, toggle } = useFavorites();
  const sun = useMemo(() => nextSunset(now, spot.lat, spot.lon), [now, spot]);
  const facts = useMemo(() => {
    if (!sun) return null;
    const tonight = viewTonight(spot, sun.bearing, profile);
    const hides = sunHidesAt(spot, sun.sunset, profile);
    const sunPath: SunPoint[] = [];
    for (let t = sun.sunset.getTime() - 150 * 60_000; t <= sun.sunset.getTime(); t += 3 * 60_000) {
      sunPath.push(getPosition(new Date(t), spot.lat, spot.lon));
    }
    const year = now.getUTCFullYear();
    return {
      tonight,
      hides,
      hidesPoint: hides ? getPosition(hides, spot.lat, spot.lon) : null,
      sunPath,
      months: viewByMonth(spot, year, profile),
      henge: spot.kind === "street" ? hengeDays(spot, year) : [],
      nextHenges: spot.kind === "street" ? upcomingHenges(spot, now, 60) : [],
    };
  }, [sun, spot, profile, now]);

  if (!sun || !facts) return <p className="mt-8 text-mist">The sun doesn&apos;t set here today.</p>;

  const { tonight, hides } = facts;
  const minutesEarly = hides ? Math.round((sun.sunset.getTime() - hides.getTime()) / 60_000) : 0;
  const openMonths = facts.months.map((v, i) => (v === "open" || v === "low" ? MONTH_NAMES[i] : null)).filter(Boolean);
  const day = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long" });
  const weekday = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/London" });
  const isTonight = sun.sunset.getUTCDate() === now.getUTCDate();
  const sameEvening = forecast && Math.abs(Date.parse(forecast.sun.sunset) - sun.sunset.getTime()) < 30 * 60_000;
  const sky = sameEvening ? skyPalette(forecast.look, "glow") : null;
  const colorsUntil = sameEvening ? ` Colors overhead until ${format(new Date(forecast.sun.bestColor.end))}.` : "";
  const favorite = isFavorite(spot.id);

  return (
    <article className="mt-3 space-y-4">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs tracking-[0.14em] text-mist uppercase">
            {KIND_LABELS[spot.kind]} · {spot.kind === "rooftop" || spot.kind === "viewpoint" ? "from the map" : "auto-found"}
          </p>
          <h1 className="mt-1 font-serif text-[40px] leading-[1.05] text-balance">{spot.name}</h1>
          {from && (
            <p className="mt-1 flex items-center gap-1.5 text-sm text-mist">
              <Footprints className="size-4" aria-hidden="true" />
              About {walkMinutes(from, spot)} min walk
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => toggle({ id: spot.id, tile, name: spot.name })}
          aria-pressed={favorite}
          aria-label={favorite ? "Remove from favorites" : "Add to favorites"}
          className="mt-4 shrink-0 rounded-full border border-white/10 p-3 hover:bg-white/10"
        >
          <Star className={`size-5 ${favorite ? "fill-[#ffc35c] text-[#ffc35c]" : "text-mist"}`} />
        </button>
      </header>

      <ViewPostcard
        spot={spot}
        profile={profile}
        sunset={sun.sunset}
        bearing={sun.bearing}
        hidesAt={hides}
        sky={sky}
        look={sameEvening ? forecast.look : null}
        caption={
          <>
            <span className="block text-[11px] font-semibold tracking-[0.16em] text-white/85 uppercase">
              Your view {isTonight ? "tonight" : "tomorrow evening"}
            </span>
            <span className="mt-1 block text-base leading-snug font-medium">
              {hides
                ? `The sun slips behind the skyline at ${format(hides)}, ${minutesEarly} min before sunset.${colorsUntil}`
                : `The sun sets in view at ${format(sun.sunset)}, toward ${Math.round(sun.bearing)}° ${compassPoint(sun.bearing)}.${colorsUntil}`}
            </span>
          </>
        }
      />

      <div className="flex flex-wrap gap-2 text-[13px]">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.06] px-3 py-1.5">
          <span className="size-2 rounded-full" style={{ backgroundColor: VIEW_COLORS[tonight.view ?? "unknown"] }} aria-hidden="true" />
          {tonight.view ? VIEWS[tonight.view].label : "View unknown"} {isTonight ? "tonight" : "tomorrow"}
        </span>
        {spot.access && (
          <span className="rounded-full border border-white/10 bg-white/[0.06] px-3 py-1.5">
            {ACCESS_TEXT[spot.access]}
            {spot.hours && <span className="text-mist"> ({spot.hours})</span>}
          </span>
        )}
        {spot.eye && spot.eye > 2 && (
          <span className="rounded-full border border-white/10 bg-white/[0.06] px-3 py-1.5">{Math.round(spot.eye)} m up</span>
        )}
      </div>

      {facts.nextHenges.length > 0 && (
        <section className="rounded-2xl border border-[#ffc35c]/40 bg-[#ffc35c]/10 p-4" aria-label="Street henge">
          <p className="font-medium text-[#ffd9a0]">Henge night{facts.nextHenges.length > 1 ? "s" : ""} coming up</p>
          <p className="mt-1 text-sm">
            The sun sets straight down this street on {facts.nextHenges.map((d) => `${weekday.format(d)} at ${format(d)}`).join(" and ")}.
          </p>
        </section>
      )}

      <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-4" aria-labelledby="year">
        <h2 id="year" className="text-sm font-medium text-mist">
          Through the year
        </h2>
        <div className="mt-3 grid grid-cols-12 gap-1">
          {facts.months.map((view, i) => (
            <div key={i} className="text-center">
              <div
                className={`h-6 rounded ${i === now.getUTCMonth() ? "ring-2 ring-ink" : ""}`}
                style={{ backgroundColor: VIEW_COLORS[view ?? "unknown"] }}
                title={`${MONTH_NAMES[i]}: ${view ? VIEWS[view].label : "unknown"}`}
              />
              <span className={`text-[10px] ${i === now.getUTCMonth() ? "text-ink" : "text-dusk"}`}>{MONTHS[i]}</span>
            </div>
          ))}
        </div>
        <p className="mt-3 text-sm text-mist">
          {openMonths.length === 12
            ? "The sunset is in view, or nearly, all year."
            : openMonths.length
              ? `The sunset is in view, or nearly, in ${openMonths.join(", ")}.`
              : "The sunset itself is hidden most of the year, but the sky above can still light up."}
        </p>
        {facts.henge.length > 0 && (
          <p className="mt-2 text-sm">
            The sun sets straight down this street around {facts.henge.map((d) => day.format(d)).join(" and ")}.
          </p>
        )}
      </section>

      <details className="group rounded-2xl border border-white/10 bg-white/[0.04] p-4">
        <summary className="cursor-pointer text-sm font-medium text-mist">Angles toward the sunset</summary>
        <div className="mt-3">
          <ProfileChart
            spot={spot}
            profile={profile}
            sunPath={facts.sunPath}
            sunsetBearing={sun.bearing}
            hidesAt={facts.hidesPoint}
          />
        </div>
        <p className="mt-1 text-xs leading-relaxed text-dusk">
          The dark shape is what&apos;s in the way (buildings, trees, hills) from south-west to north-west, true to scale.
          The dotted line is the sun&apos;s path tonight.
        </p>
      </details>

      <section className="space-y-2 text-sm" aria-label="Getting there">
        <div className="flex flex-wrap gap-2">
          <a
            href={`https://www.google.com/maps/dir/?api=1&destination=${spot.lat},${spot.lon}&travelmode=walking`}
            className="inline-flex min-h-11 items-center gap-1 rounded-full bg-ember px-4 font-semibold text-night hover:brightness-110"
          >
            Directions <ArrowUpRight className="size-4" aria-hidden="true" />
          </a>
          <a
            href={`https://citymapper.com/directions?endcoord=${spot.lat},${spot.lon}&endname=${encodeURIComponent(spot.name)}`}
            className="inline-flex min-h-11 items-center gap-1 rounded-full bg-white/10 px-4 hover:bg-white/15"
          >
            Citymapper <ArrowUpRight className="size-4" aria-hidden="true" />
          </a>
        </div>
        <p className="pt-1 text-xs leading-relaxed text-dusk">
          Found automatically from OpenStreetMap and Ordnance Survey data. Trees and building heights can be off, so
          check the view the first time you go.
        </p>
      </section>
    </article>
  );
}
