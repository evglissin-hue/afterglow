"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { getPosition } from "suncalc";
import {
  Bell,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  CircleMinus,
  Clock,
  Info,
  Radio,
  LocateFixed,
  Map as MapIcon,
  MapPin,
  NotebookPen,
  RefreshCw,
  Sunset,
} from "lucide-react";
import type { Forecast } from "@/lib/forecast/getForecast";
import type { Reason } from "@/lib/forecast/score";
import { sunEvents } from "@/lib/sun";
import { AlertsSync } from "./AlertsSync";
import { BestNearYou } from "./BestNearYou";
import { CloudSection } from "./CloudSection";
import { HengeNights } from "./HengeNights";
import { InstallApp } from "./InstallApp";
import { Outlook } from "./Outlook";
import { PlaceSearch } from "./PlaceSearch";
import { ScoreDial } from "./ScoreDial";
import { ShareButton } from "./ShareButton";
import { SkyBackdrop } from "./SkyBackdrop";
import { friendlyError, loadForecast, placeKey } from "./loadForecast";
import { SkyStrip } from "./SkyStrip";
import { SunCompass } from "./SunCompass";
import { SunTimeline } from "./SunTimeline";
import { skyPalette, skyPhase, type SkyPhase } from "./sky";
import { usePlace, type Place } from "./usePlace";
import { useNow } from "./useNow";

type Loaded = { key: string; forecast?: Forecast; savedAt?: number; error?: string };

const CONFIDENCE_TEXT = {
  high: "High confidence: the weather models agree",
  medium: "Medium confidence: the weather models partly agree",
  low: "Low confidence: the weather models disagree",
} as const;

/** Where the evening is now, for the sky colors. Before the forecast arrives, only day or night. */
function useSkyPhase(now: Date | null, place: Place | null, forecast: Forecast | null): SkyPhase {
  if (!now || !place) return "night";
  const altitude = getPosition(now, place.lat, place.lon).altitude;
  if (!forecast) return altitude < -6 ? "night" : "day";
  return skyPhase(now, forecast.sun, altitude);
}

export default function Tonight() {
  const { place, locate, chooseLondon, choose } = usePlace();
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
      <AlertsSync />
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-lg font-semibold tracking-tight">
          <Sunset className="size-5 text-ember" aria-hidden="true" />
          Afterglow
        </div>
        <nav className="flex items-center gap-1 text-mist">
          <Link href="/map" aria-label="Map" className="grid size-11 place-items-center rounded-full hover:bg-white/10 hover:text-ink">
            <MapIcon className="size-5" />
          </Link>
          <Link href="/me" aria-label="My sunsets" className="grid size-11 place-items-center rounded-full hover:bg-white/10 hover:text-ink">
            <NotebookPen className="size-5" />
          </Link>
          <Link href="/alerts" aria-label="Sunset alerts" className="grid size-11 place-items-center rounded-full hover:bg-white/10 hover:text-ink">
            <Bell className="size-5" />
          </Link>
          <Link href="/about" aria-label="About" className="grid size-11 place-items-center rounded-full hover:bg-white/10 hover:text-ink">
            <Info className="size-5" />
          </Link>
        </nav>
      </header>

      <LocationRow place={place} onUseDevice={locate} onUseLondon={chooseLondon} onChoose={choose} />

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
  onChoose,
}: {
  place: Place | null;
  onUseDevice: () => void;
  onUseLondon: () => void;
  onChoose: (place: Place) => void;
}) {
  const [searching, setSearching] = useState(false);
  const label = !place
    ? "Finding you…"
    : place.source === "device"
      ? "Near you"
      : place.source === "search" && place.name
        ? place.name
        : "Central London";

  return (
    <div className="mt-2 mb-3 flex flex-wrap items-center gap-x-2 text-sm text-mist">
      <button
        type="button"
        onClick={() => setSearching(true)}
        className="-ml-1 inline-flex min-h-11 max-w-[60%] items-center gap-1.5 rounded-full px-1 hover:text-ink"
        aria-label={`Place: ${label}. Change`}
      >
        <MapPin className="size-4 shrink-0" aria-hidden="true" />
        <span className="truncate">{label}</span>
        <ChevronDown className="size-3.5 shrink-0" aria-hidden="true" />
      </button>
      {place && place.source !== "device" && (
        <button type="button" onClick={onUseDevice} className="inline-flex min-h-11 items-center gap-1 underline underline-offset-2 hover:text-ink">
          <LocateFixed className="size-3.5" aria-hidden="true" />
          Use my location
        </button>
      )}
      {place?.source === "device" && (
        <button type="button" onClick={onUseLondon} className="min-h-11 underline underline-offset-2 hover:text-ink">
          Use central London
        </button>
      )}
      {searching && (
        <PlaceSearch
          onClose={() => setSearching(false)}
          onUseDevice={() => {
            setSearching(false);
            onUseDevice();
          }}
          onChoose={(next) => {
            setSearching(false);
            onChoose(next);
          }}
        />
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
        <div className="mt-4 flex flex-wrap justify-center gap-2 [text-shadow:none]">
          {isLiveTime(forecast, now) && (
            <Link
              href="/live"
              className="inline-flex min-h-11 items-center gap-2 rounded-full bg-[#fff7ec] px-4 text-sm font-semibold text-night hover:brightness-95"
            >
              <Radio className="size-4" aria-hidden="true" />
              {now && now.getTime() < Date.parse(sun.sunset) ? "Sunset soon: go live" : "It's happening: go live"}
            </Link>
          )}
          {isLogTime(forecast, now) && (
            <Link
              href="/log"
              className="inline-flex min-h-11 items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 text-sm font-medium backdrop-blur hover:bg-white/15"
            >
              <NotebookPen className="size-4" aria-hidden="true" />
              Log it
            </Link>
          )}
          <ShareButton forecast={forecast} placeLabel={place.source === "search" && place.name ? place.name : "London"} />
        </div>
      </section>

      <SunTimeline forecast={forecast} now={now} format={format} />

      <Outlook place={place} tonight={forecast} />

      <BestNearYou place={place} forecast={forecast} now={now} />

      <HengeNights place={place} now={now} />

      <Link
        href="/compass"
        className="flex items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.04] p-4 hover:bg-white/[0.07]"
      >
        <SunCompass bearing={sun.bearing} />
        <div className="min-w-0 flex-1">
          <p className="font-medium">
            The sun sets toward {sun.bearing}° {sun.compass}
          </p>
          <p className="text-sm text-mist">Find that way with your phone&apos;s compass.</p>
        </div>
        <ChevronRight className="size-4 shrink-0 text-dusk" aria-hidden="true" />
      </Link>

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

/**
 * Offer to log today's sunset from when it happens until six hours later, even after the screen has
 * moved on to tomorrow's forecast.
 */
function isLogTime(forecast: Forecast, now: Date | null): boolean {
  if (!now) return false;
  const today = sunEvents(now, forecast.location.lat, forecast.location.lon);
  const since = today ? now.getTime() - today.sunset.getTime() : -1;
  return since >= 0 && since <= 6 * 3_600_000;
}

/** Live mode is offered from half an hour before sunset until last light. */
function isLiveTime(forecast: Forecast, now: Date | null): boolean {
  if (!now) return false;
  const t = now.getTime();
  return t >= Date.parse(forecast.sun.sunset) - 30 * 60_000 && t <= Date.parse(forecast.sun.lastLight);
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
