"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { getPosition } from "suncalc";
import {
  CircleAlert,
  CircleCheck,
  CircleMinus,
  Clock,
  Info,
  LocateFixed,
  Map as MapIcon,
  MapPin,
  RefreshCw,
  Sunset,
} from "lucide-react";
import { getForecast, type Forecast } from "@/lib/forecast/getForecast";
import type { Reason } from "@/lib/forecast/score";
import { BestNearYou } from "./BestNearYou";
import { CloudSection } from "./CloudSection";
import { InstallApp } from "./InstallApp";
import { ScoreDial } from "./ScoreDial";
import { SkyBackdrop } from "./SkyBackdrop";
import { FORECAST_KEY } from "./forecastCache";
import { SkyStrip } from "./SkyStrip";
import { SunCompass } from "./SunCompass";
import { SunTimeline } from "./SunTimeline";
import { skyPalette, skyPhase, type SkyPhase } from "./sky";
import { usePlace, type Place } from "./usePlace";

const CACHE_MS = 30 * 60 * 1000;

type Loaded = { key: string; forecast?: Forecast; savedAt?: number; error?: string };
/** A forecast, and when it was fetched if it's an older saved copy shown because a refresh failed. */
type Fetched = { forecast: Forecast; savedAt?: number };

const CONFIDENCE_TEXT = {
  high: "High confidence: the weather models agree",
  medium: "Medium confidence: the weather models partly agree",
  low: "Low confidence: the weather models disagree",
} as const;

const placeKey = (p: Place) => `${p.lat.toFixed(1)},${p.lon.toFixed(1)}`;

async function loadForecast(place: Place): Promise<Fetched> {
  const storageKey = `${FORECAST_KEY}${placeKey(place)}`;
  let cached: { savedAt: number; forecast: Forecast } | null = null;
  try {
    cached = JSON.parse(localStorage.getItem(storageKey) ?? "null");
  } catch {
    // Storage unavailable or corrupt: fetch fresh.
  }
  const now = Date.now();
  const stillTonight = cached !== null && now < Date.parse(cached.forecast.sun.lastLight);
  if (cached && stillTonight && now - cached.savedAt < CACHE_MS) return { forecast: cached.forecast };
  let forecast: Forecast;
  try {
    forecast = await getForecastWithFallback(place);
  } catch (error) {
    // No signal (say, out in a park): an older forecast for tonight beats an error.
    if (cached && stillTonight) return { forecast: cached.forecast, savedAt: cached.savedAt };
    throw error;
  }
  try {
    localStorage.setItem(storageKey, JSON.stringify({ savedAt: Date.now(), forecast }));
  } catch {
    // Private mode or full storage: fine without a cache.
  }
  return { forecast };
}

/**
 * Ask Open-Meteo straight from the browser, so each visitor uses their own free quota.
 * If that fails (e.g. a shared network hit the daily limit), try our server instead.
 */
async function getForecastWithFallback(place: Place): Promise<Forecast> {
  try {
    return await getForecast(place.lat, place.lon);
  } catch (direct) {
    const response = await fetch(`/api/forecast?lat=${place.lat}&lon=${place.lon}`).catch(() => null);
    if (response?.ok) return (await response.json()) as Forecast;
    // The server can read error details the browser can't, so prefer its message.
    const serverError: unknown = await response
      ?.json()
      .then((body: { error?: unknown }) => body.error)
      .catch(() => null);
    throw new Error(typeof serverError === "string" ? serverError : (direct as Error).message);
  }
}

function friendlyError(message: string): string {
  if (/limit|429/i.test(message)) {
    return "The free weather service has hit its daily limit for this network. Try again later.";
  }
  if (/reach|fetch|network/i.test(message)) {
    return "Couldn't reach the weather service. Check your connection and try again.";
  }
  return message;
}

/** The current time, refreshed every 30 s. Null until mounted, so nothing time-based renders on the server. */
function useNow(): Date | null {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const tick = () => setNow(new Date());
    const first = setTimeout(tick, 0);
    const every = setInterval(tick, 30_000);
    return () => {
      clearTimeout(first);
      clearInterval(every);
    };
  }, []);
  return now;
}

/** Where the evening is now, for the sky colors. Before the forecast arrives, only day or night. */
function useSkyPhase(now: Date | null, place: Place | null, forecast: Forecast | null): SkyPhase {
  if (!now || !place) return "night";
  const altitude = getPosition(now, place.lat, place.lon).altitude;
  if (!forecast) return altitude < -6 ? "night" : "day";
  return skyPhase(now, forecast.sun, altitude);
}

export default function Tonight() {
  const { place, locate, chooseLondon } = usePlace();
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const now = useNow();

  const key = place ? `${placeKey(place)}#${attempt}` : null;
  useEffect(() => {
    if (!place || !key) return;
    let cancelled = false;
    loadForecast(place).then(
      ({ forecast, savedAt }) => !cancelled && setLoaded({ key, forecast, savedAt }),
      (error: unknown) =>
        !cancelled && setLoaded({ key, error: error instanceof Error ? error.message : String(error) }),
    );
    return () => {
      cancelled = true;
    };
  }, [place, key]);

  const current = loaded && loaded.key === key ? loaded : null;
  const forecast = current?.forecast ?? null;
  const phase = useSkyPhase(now, place, forecast);
  const sky = skyPalette(forecast?.look ?? null, phase);

  return (
    <main className="mx-auto w-full max-w-md px-4 pt-[max(1.25rem,env(safe-area-inset-top))] pb-14">
      <SkyBackdrop sky={sky} phase={phase} />
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-lg font-semibold tracking-tight">
          <Sunset className="size-5 text-ember" aria-hidden="true" />
          Afterglow
        </div>
        <nav className="flex items-center gap-1 text-sm text-mist">
          <Link href="/map" className="flex items-center gap-1.5 rounded-full px-3 py-1.5 hover:bg-white/5">
            <MapIcon className="size-4" aria-hidden="true" />
            Map
          </Link>
          <Link href="/about" className="flex items-center gap-1.5 rounded-full px-3 py-1.5 hover:bg-white/5">
            <Info className="size-4" aria-hidden="true" />
            About
          </Link>
        </nav>
      </header>

      <LocationRow place={place} onUseDevice={locate} onUseLondon={chooseLondon} />

      {!current ? (
        <LoadingCard locating={!place} />
      ) : current.error || !current.forecast ? (
        <ErrorCard message={current.error ?? "Something went wrong."} onRetry={() => setAttempt((a) => a + 1)} />
      ) : (
        <>
          {current.savedAt && <SavedNote savedAt={current.savedAt} onRetry={() => setAttempt((a) => a + 1)} />}
          <ForecastView forecast={current.forecast} now={now} place={place!} sky={sky} />
        </>
      )}

      <InstallApp />

      <footer className="mt-10 space-y-2 text-xs leading-relaxed text-dusk">
        <p>Forecasts are best guesses. Cloud forecasts can be wrong.</p>
        <p>
          Weather data by{" "}
          <a href="https://open-meteo.com" className="underline underline-offset-2 hover:text-mist">
            Open-Meteo.com
          </a>{" "}
          (CC BY 4.0), with air quality from the Copernicus Atmosphere Monitoring Service.
        </p>
      </footer>
    </main>
  );
}

function LocationRow({
  place,
  onUseDevice,
  onUseLondon,
}: {
  place: Place | null;
  onUseDevice: () => void;
  onUseLondon: () => void;
}) {
  return (
    <div className="mt-3 mb-4 flex items-center gap-2 text-sm text-mist">
      <MapPin className="size-4 shrink-0" aria-hidden="true" />
      {!place ? (
        <span>Finding you…</span>
      ) : place.source === "device" ? (
        <>
          <span>Near you</span>
          <span aria-hidden="true">·</span>
          <button type="button" onClick={onUseLondon} className="underline underline-offset-2 hover:text-ink">
            Use central London
          </button>
        </>
      ) : (
        <>
          <span>Central London</span>
          <span aria-hidden="true">·</span>
          <button
            type="button"
            onClick={onUseDevice}
            className="inline-flex items-center gap-1 underline underline-offset-2 hover:text-ink"
          >
            <LocateFixed className="size-3.5" aria-hidden="true" />
            Use my location
          </button>
        </>
      )}
    </div>
  );
}

function LoadingCard({ locating }: { locating: boolean }) {
  return (
    <div className="animate-pulse rounded-3xl border border-white/10 bg-white/[0.04] p-6" aria-live="polite">
      <div className="flex items-center gap-5">
        <div className="size-28 rounded-full border-8 border-white/10" />
        <div className="flex-1 space-y-3">
          <div className="h-3 w-24 rounded bg-white/10" />
          <div className="h-6 w-32 rounded bg-white/10" />
          <div className="h-3 w-40 rounded bg-white/10" />
        </div>
      </div>
      <p className="mt-5 text-sm text-mist">{locating ? "Finding you…" : "Checking the sky along the sunset line…"}</p>
    </div>
  );
}

function SavedNote({ savedAt, onRetry }: { savedAt: number; onRetry: () => void }) {
  const time = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" }).format(savedAt);
  return (
    <p className="mb-3 flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm text-mist" role="status">
      <span>Couldn&apos;t refresh. Showing the forecast from {time}.</span>
      <button type="button" onClick={onRetry} className="inline-flex shrink-0 items-center gap-1.5 text-ink hover:underline">
        <RefreshCw className="size-3.5" aria-hidden="true" />
        Retry
      </button>
    </p>
  );
}

function ErrorCard({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-6" role="alert">
      <p className="font-medium">Couldn&apos;t get tonight&apos;s forecast.</p>
      <p className="mt-1 text-sm text-mist">{friendlyError(message)}</p>
      {friendlyError(message) !== message && <p className="mt-2 text-xs text-dusk">{message}</p>}
      <button
        type="button"
        onClick={onRetry}
        className="mt-4 inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-sm hover:bg-white/15"
      >
        <RefreshCw className="size-4" aria-hidden="true" />
        Try again
      </button>
    </div>
  );
}

function ForecastView({
  forecast,
  now,
  place,
  sky,
}: {
  forecast: Forecast;
  now: Date | null;
  place: Place;
  sky: ReturnType<typeof skyPalette>;
}) {
  const { sun, location } = forecast;
  const format = useMemo(() => {
    const fmt = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: location.timezone });
    // Round to the nearest minute: 16:29:54 reads as 16:30.
    return (iso: string) => fmt.format(new Date(Math.round(Date.parse(iso) / 60_000) * 60_000));
  }, [location.timezone]);

  return (
    <div className="space-y-4">
      <section className="pt-2 pb-3 text-center [text-shadow:0_1px_14px_rgba(0,0,0,0.35)]" aria-label="Tonight's sunset forecast">
        <p className="text-xs font-medium tracking-[0.16em] text-white/90 uppercase">{statusLine(forecast, now, format)}</p>
        <div className="mt-4 flex justify-center">
          <ScoreDial score={forecast.score} label={forecast.label} ring={sky.ring} glow={sky.glow[0]} />
        </div>
        <h1 className="mt-4 font-serif text-[42px] leading-[1.02] font-normal text-balance italic">{forecast.lookTitle}</h1>
        <p className="mx-auto mt-2.5 max-w-xs text-[15px] leading-snug text-white/90">{forecast.lookText}</p>
        <p className="mt-3 flex items-center justify-center gap-2 text-xs text-white/80">
          <ConfidenceDots level={forecast.confidence} />
          {CONFIDENCE_TEXT[forecast.confidence]}
        </p>
      </section>

      <SunTimeline forecast={forecast} now={now} format={format} />

      <BestNearYou place={place} forecast={forecast} now={now} />

      <section className="flex items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
        <SunCompass bearing={sun.bearing} />
        <div>
          <p className="font-medium">
            The sun sets toward {sun.bearing}° {sun.compass}
          </p>
          <p className="text-sm text-mist">Find a spot with an open view that way.</p>
        </div>
      </section>

      <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-4" aria-labelledby="why">
        <h2 id="why" className="text-sm font-medium text-mist">
          Why
        </h2>
        <ul className="mt-2 space-y-2">
          {forecast.why.map((reason) => (
            <li key={reason.text} className="flex items-start gap-2.5">
              <ReasonIcon tone={reason.tone} />
              <span>{reason.text}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-4" aria-labelledby="sky">
        <h2 id="sky" className="text-sm font-medium text-mist">
          Sky along the sunset line
        </h2>
        <p className="mt-1 mb-3 text-xs leading-relaxed text-dusk">
          From 25 km behind you to 300 km toward the sun. Cloud near you lights up; cloud far toward the sun
          can block the light.
        </p>
        <CloudSection path={forecast.path} gapBlock={forecast.factors.gapBlock} />
        <details className="group mt-2">
          <summary className="cursor-pointer py-1 text-xs text-mist hover:text-ink">Show the numbers</summary>
          <p className="mt-1 mb-2 text-xs leading-relaxed text-dusk">
            Cloud cover (%) at each point, in the {forecast.models.length > 1 ? "middle" : "only"} model.
          </p>
          <SkyStrip path={forecast.path} />
        </details>
      </section>

      <section className="flex flex-wrap items-center gap-2 text-xs text-mist" aria-label="Scores by model">
        <Clock className="size-3.5" aria-hidden="true" />
        {forecast.models.map((m) => (
          <span key={m.id} className="rounded-full border border-white/10 px-2.5 py-1">
            {m.name} <span className="font-medium text-ink tabular-nums">{m.score}</span>
          </span>
        ))}
      </section>
    </div>
  );
}

function statusLine(forecast: Forecast, now: Date | null, format: (iso: string) => string): string {
  const sunset = Date.parse(forecast.sun.sunset);
  const bestEnd = Date.parse(forecast.sun.bestColor.end);
  if (!now) return `Tonight · sunset ${format(forecast.sun.sunset)}`;
  const day = dayKey(now, forecast.location.timezone) === dayKey(new Date(sunset), forecast.location.timezone);
  const when = day ? "Tonight" : "Tomorrow evening";
  if (now.getTime() < sunset) return `${when} · sunset in ${duration(sunset - now.getTime())}`;
  if (now.getTime() < bestEnd) return `Happening now · best color until ${format(forecast.sun.bestColor.end)}`;
  return `Last light at ${format(forecast.sun.lastLight)}`;
}

function dayKey(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function duration(ms: number) {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours} h ${String(minutes % 60).padStart(2, "0")} min` : `${minutes} min`;
}

function ReasonIcon({ tone }: { tone: Reason["tone"] }) {
  if (tone === "good") return <CircleCheck className="mt-0.5 size-4 shrink-0 text-good" aria-label="good" />;
  if (tone === "bad") return <CircleAlert className="mt-0.5 size-4 shrink-0 text-bad" aria-label="bad" />;
  return <CircleMinus className="mt-0.5 size-4 shrink-0 text-mist" aria-label="neutral" />;
}

function ConfidenceDots({ level }: { level: Forecast["confidence"] }) {
  const filled = level === "high" ? 3 : level === "medium" ? 2 : 1;
  return (
    <span className="flex gap-0.5" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <span key={i} className={`size-1.5 rounded-full ${i < filled ? "bg-white" : "bg-white/30"}`} />
      ))}
    </span>
  );
}
