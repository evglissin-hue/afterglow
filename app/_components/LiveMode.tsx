"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getPosition } from "suncalc";
import { Clock, Cloud, Compass, RotateCcw, X } from "lucide-react";
import type { Forecast } from "@/lib/forecast/getForecast";
import { loadForecast, placeKey } from "./loadForecast";
import { ShareButton } from "./ShareButton";
import { SkyBackdrop } from "./SkyBackdrop";
import { skyPalette, skyPhase } from "./sky";
import { usePlace } from "./usePlace";
import { useNow } from "./useNow";

const LOG_KEY = "afterglow:my-sunsets";
const RING = 2 * Math.PI * 60;

/** A sunset rated in live mode, kept on this phone (uploaded once accounts exist). */
export interface LoggedSunset {
  date: string;
  rating: number;
  at: string;
  lat: number;
  lon: number;
  forecast: { score: number; label: string; look: string };
}

type Stage = { title: string; line: string; until: number; from: number };

/** What's happening now, and the countdown ring's span. */
function stageFor(forecast: Forecast, t: number, format: (iso: string) => string): Stage {
  const sunset = Date.parse(forecast.sun.sunset);
  const bestStart = Date.parse(forecast.sun.bestColor.start);
  const bestEnd = Date.parse(forecast.sun.bestColor.end);
  const lastLight = Date.parse(forecast.sun.lastLight);
  const minutes = (ms: number) => Math.max(1, Math.ceil(ms / 60_000));
  if (t < sunset - 30 * 60_000)
    return { title: "Not yet", line: `Sunset at ${format(forecast.sun.sunset)}. Live mode lights up 30 minutes before.`, from: t, until: t };
  if (t < sunset) return { title: "Sunset soon", line: `The sun sets in ${minutes(sunset - t)} min.`, from: sunset - 30 * 60_000, until: sunset };
  if (t < bestStart) return { title: "Here it comes", line: `Best color from ${format(forecast.sun.bestColor.start)}.`, from: sunset, until: bestStart };
  if (t <= bestEnd) return { title: "Look up now", line: `Best color until ${format(forecast.sun.bestColor.end)}.`, from: bestStart, until: bestEnd };
  if (t <= lastLight) return { title: "Fading now", line: `Last light at ${format(forecast.sun.lastLight)}.`, from: bestEnd, until: lastLight };
  return { title: "That's it for tonight", line: "How was it?", from: t, until: t };
}

function tipsFor(forecast: Forecast) {
  const tips: { icon: typeof Cloud; text: string }[] = [
    { icon: Compass, text: `Face ${forecast.sun.compass}, toward ${forecast.sun.bearing}°.` },
  ];
  if (forecast.look === "grey" || forecast.look === "blocked") {
    tips.push({ icon: Cloud, text: "Cloud may hide it. Watch for a gap low in the sky toward the sun." });
  } else if (forecast.sun.bestColor.layer === "high") {
    tips.push({ icon: Clock, text: "High cloud lights up last, after the sun has gone. Don't leave early." });
  } else if (forecast.sun.bestColor.layer === "mid") {
    tips.push({ icon: Cloud, text: "Watch the clouds overhead: they catch fire around sunset." });
  }
  tips.push({ icon: RotateCcw, text: "Turn around now and then: a pink band, the Belt of Venus, rises in the east." });
  return tips;
}

function readLog(): LoggedSunset[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(LOG_KEY) ?? "[]");
    return Array.isArray(value) ? (value as LoggedSunset[]) : [];
  } catch {
    return [];
  }
}

/** Full-screen companion for the evening itself: a countdown, what to watch, and a quick rating. */
export function LiveMode() {
  const { place } = usePlace();
  const now = useNow(15_000);
  const [loaded, setLoaded] = useState<{ key: string; forecast?: Forecast; error?: boolean } | null>(null);
  const [rating, setRating] = useState<number | null>(null);
  const key = place ? placeKey(place) : null;

  useEffect(() => {
    if (!place || !key) return;
    let cancelled = false;
    loadForecast(place).then(
      ({ forecast }) => !cancelled && setLoaded({ key, forecast }),
      () => !cancelled && setLoaded({ key, error: true }),
    );
    return () => {
      cancelled = true;
    };
  }, [place, key]);

  // Keep the screen on while you watch.
  useEffect(() => {
    let lock: WakeLockSentinel | null = null;
    const request = () => navigator.wakeLock?.request("screen").then((l) => (lock = l), () => undefined);
    request();
    const again = () => document.visibilityState === "visible" && request();
    document.addEventListener("visibilitychange", again);
    return () => {
      document.removeEventListener("visibilitychange", again);
      lock?.release().catch(() => undefined);
    };
  }, []);

  const forecast = loaded && loaded.key === key ? loaded.forecast : undefined;
  const altitude = now && place ? getPosition(now, place.lat, place.lon).altitude : 0;
  const phase = forecast && now ? skyPhase(now, forecast.sun, altitude) : "golden";
  const sky = skyPalette(forecast?.look ?? null, phase === "night" ? "glow" : phase);

  const format = (iso: string) =>
    new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: forecast?.location.timezone ?? "Europe/London" }).format(
      new Date(Math.round(Date.parse(iso) / 60_000) * 60_000),
    );

  const rate = (value: number) => {
    if (!forecast || !place || !now) return;
    const date = new Intl.DateTimeFormat("en-CA", { timeZone: forecast.location.timezone }).format(new Date(forecast.sun.sunset));
    const entry: LoggedSunset = {
      date,
      rating: value,
      at: now.toISOString(),
      lat: Math.round(place.lat * 100) / 100,
      lon: Math.round(place.lon * 100) / 100,
      forecast: { score: forecast.score, label: forecast.label, look: forecast.look },
    };
    try {
      localStorage.setItem(LOG_KEY, JSON.stringify([...readLog().filter((e) => e.date !== date), entry]));
    } catch {
      // Storage blocked: the rating can't be kept.
    }
    setRating(value);
  };

  const stage = forecast && now ? stageFor(forecast, now.getTime(), format) : null;
  const span = stage ? stage.until - stage.from : 0;
  const left = stage && now ? Math.max(0, stage.until - now.getTime()) : 0;
  const fraction = span > 0 ? left / span : 0;
  const placeLabel = place?.source === "search" && place.name ? place.name : "London";

  return (
    <main className="relative mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 pt-[max(0.75rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))]">
      <SkyBackdrop sky={sky} phase={phase === "night" ? "glow" : phase} />
      <div className="flex items-center justify-between">
        <p className="inline-flex min-h-9 items-center gap-2 rounded-full bg-night/45 px-3.5 text-[13px] font-medium">
          <span className="size-2 rounded-full bg-[#ffd36b] shadow-[0_0_0_4px_rgba(255,211,107,0.3)]" aria-hidden="true" />
          Live · {placeLabel}
        </p>
        <Link href="/" aria-label="Close live mode" className="grid size-11 place-items-center rounded-full bg-night/45">
          <X className="size-5" />
        </Link>
      </div>

      {!forecast || !stage ? (
        <p className="mt-24 text-center text-white/85">{loaded?.error ? "Couldn't get tonight's forecast." : "Checking the sky…"}</p>
      ) : (
        <>
          <div className="relative mx-auto mt-10 size-36" role="timer" aria-label={stage.line}>
            <svg viewBox="0 0 132 132" className="size-full -rotate-90" aria-hidden="true">
              <circle cx="66" cy="66" r="60" fill="none" stroke="rgba(255,247,236,0.2)" strokeWidth="4" />
              <circle
                cx="66"
                cy="66"
                r="60"
                fill="none"
                stroke="#fff7ec"
                strokeWidth="4"
                strokeLinecap="round"
                strokeDasharray={RING}
                strokeDashoffset={RING * (1 - fraction)}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center [text-shadow:0_1px_12px_rgba(0,0,0,0.35)]">
              {span > 0 ? (
                <>
                  <span className="text-5xl leading-none font-semibold tabular-nums">{Math.ceil(left / 60_000)}</span>
                  <span className="mt-1 text-xs tracking-[0.14em] uppercase">min left</span>
                </>
              ) : (
                <span className="text-4xl font-semibold tabular-nums">{forecast.score}</span>
              )}
            </div>
          </div>

          <h1 className="mt-6 text-center font-serif text-[56px] leading-none italic [text-shadow:0_1px_14px_rgba(0,0,0,0.35)]">
            {stage.title}
          </h1>
          <p className="mt-3 text-center text-[17px] [text-shadow:0_1px_10px_rgba(0,0,0,0.35)]">{stage.line}</p>
          <p className="mt-1 text-center text-sm text-white/80">
            {forecast.label} ({forecast.score}) · {forecast.lookTitle}
          </p>

          <ul className="mt-7 divide-y divide-white/10 rounded-3xl bg-night/55 px-4 backdrop-blur-md">
            {tipsFor(forecast).map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3 py-3 text-[15px]">
                <Icon className="size-5 shrink-0 text-[#ffd36b]" aria-hidden="true" />
                {text}
              </li>
            ))}
          </ul>

          <div className="mt-auto pt-8 text-center">
            {rating ? (
              <p className="text-[15px]">Saved: {rating} of 5. Thanks!</p>
            ) : (
              <>
                <p className="text-[15px] font-medium">How does it look?</p>
                <div className="mt-3 flex justify-center gap-2.5" role="group" aria-label="Rate tonight's sunset">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => rate(n)}
                      aria-label={`${n} of 5`}
                      className="grid size-12 place-items-center rounded-full border border-white/25 bg-night/40 text-base font-semibold backdrop-blur hover:bg-white/15"
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </>
            )}
            <p className="mt-2 text-xs text-white/70">Ratings stay on this phone for now, to tune the forecast later.</p>
            <ShareButton forecast={forecast} placeLabel={placeLabel} className="mt-4" />
          </div>
        </>
      )}
    </main>
  );
}
