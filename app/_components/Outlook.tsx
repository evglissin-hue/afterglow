"use client";

import { useEffect, useState } from "react";
import { gridPoint } from "@/lib/forecast/getForecast";
import { getOutlook, localDate, type Outlook as OutlookData, type OutlookDay } from "@/lib/forecast/getOutlook";
import type { Label, Look } from "@/lib/forecast/score";
import { nextSunset } from "@/lib/sun";
import type { Place } from "./usePlace";

/** How long an outlook is kept in the browser, per 0.1° grid cell. */
const CACHE_MS = 3 * 60 * 60 * 1000;

/** Ring colors, warming from grey to gold as the label improves. All at least 3:1 on the card. */
const LABEL_COLORS: Record<Label, string> = {
  Poor: "#6e677b",
  Fair: "#b0849f",
  Good: "#e57a72",
  Great: "#f08a3c",
  Epic: "#ffc35c",
};

/** One or two words for each look, to fit under a ring. */
const SHORT_LOOKS: Record<Look, string> = {
  grey: "Grey",
  blocked: "Blocked",
  hazy: "Hazy",
  clean: "Clear sky",
  wholeSky: "Whole sky",
  pastel: "Pastel",
  fiery: "Fiery",
  golden: "Golden",
};

const COUNT_WORDS = ["", "one", "two", "three", "four", "five", "six", "seven"];

/** What the strip shows: the evenings still to come, and today's date where they are. */
type Strip = { days: OutlookDay[]; today: string };
type Loaded = { key: string; strip?: Strip };

/**
 * The next five evenings at a glance: a score ring for each, and the best one named above.
 * Hidden if the outlook can't be loaded.
 */
export function Outlook({ place }: { place: Place | null }) {
  const cell = place ? gridPoint(place.lat, place.lon) : null;
  const lat = cell?.lat ?? null;
  const lon = cell?.lon ?? null;
  const key = cell ? `${lat},${lon}` : null;
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  useEffect(() => {
    if (lat === null || lon === null) return;
    let cancelled = false;
    loadStrip(lat, lon).then(
      (strip) => !cancelled && setLoaded({ key: `${lat},${lon}`, strip }),
      () => !cancelled && setLoaded({ key: `${lat},${lon}` }),
    );
    return () => {
      cancelled = true;
    };
  }, [lat, lon]);

  const current = loaded && loaded.key === key ? loaded : null;
  if (!current) return <StripSkeleton />;
  // Nothing to compare with only one evening: Tonight already shows it.
  if (!current.strip || current.strip.days.length < 2) return null;
  return <StripView {...current.strip} />;
}

async function loadStrip(lat: number, lon: number): Promise<Strip> {
  const now = new Date();
  const outlook = await loadOutlook(lat, lon, now);
  return { days: upcoming(outlook, now), today: localDate(now, outlook.location.timezone) };
}

async function loadOutlook(lat: number, lon: number, now: Date): Promise<OutlookData> {
  const storageKey = `afterglow:outlook:${lat},${lon}`;
  let saved: { savedAt: number; outlook: OutlookData } | null = null;
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey) ?? "null");
    // Anything else (say, saved by an older version of the app) is ignored.
    if (typeof parsed?.savedAt === "number" && Array.isArray(parsed.outlook?.days) && parsed.outlook.location) {
      saved = parsed;
    }
  } catch {
    // Storage blocked or corrupt: fetch fresh.
  }
  // A saved outlook is only good while its first evening is still the coming one.
  const stillCurrent = saved !== null && upcoming(saved.outlook, now).length === saved.outlook.days.length;
  if (saved && stillCurrent && now.getTime() - saved.savedAt < CACHE_MS) return saved.outlook;

  let outlook: OutlookData;
  try {
    outlook = await getOutlookWithFallback(lat, lon);
  } catch (error) {
    // No signal (say, out in a park): an older outlook for the same evenings beats nothing.
    if (saved && stillCurrent) return saved.outlook;
    throw error;
  }
  try {
    localStorage.setItem(storageKey, JSON.stringify({ savedAt: Date.now(), outlook }));
  } catch {
    // Private mode or full storage: fine without a cache.
  }
  return outlook;
}

/**
 * Ask Open-Meteo straight from the browser, so each visitor uses their own free quota.
 * If that fails (e.g. a shared network hit the daily limit), try our server instead.
 */
async function getOutlookWithFallback(lat: number, lon: number): Promise<OutlookData> {
  try {
    return await getOutlook(lat, lon);
  } catch (direct) {
    const response = await fetch(`/api/outlook?lat=${lat}&lon=${lon}`).catch(() => null);
    if (response?.ok) return (await response.json()) as OutlookData;
    throw direct;
  }
}

/** The evenings that haven't passed: the first is the sunset the Tonight screen shows. */
function upcoming(outlook: OutlookData, now: Date): OutlookDay[] {
  const next = nextSunset(now, outlook.location.lat, outlook.location.lon);
  if (!next) return [];
  return outlook.days.filter((day) => Date.parse(day.sunset) > next.sunset.getTime() - 60_000);
}

/** "Tonight" or the weekday, e.g. "Thu" (short) or "Thursday" (long). */
function dayName(day: OutlookDay, today: string, style: "short" | "long"): string {
  if (day.date === today) return "Tonight";
  // The date is already local to the place, so format it as a plain calendar date.
  return new Intl.DateTimeFormat("en-US", { weekday: style, timeZone: "UTC" }).format(new Date(`${day.date}T12:00:00Z`));
}

function StripView({ days, today }: Strip) {
  // The earliest wins a tie: it's the surer forecast.
  const best = days.reduce((a, b) => (b.score > a.score ? b : a));
  const worthIt = best.label !== "Poor" && best.label !== "Fair";
  const count = COUNT_WORDS[days.length] ?? String(days.length);

  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-4" aria-labelledby="outlook">
      <h2 id="outlook" className="text-sm text-mist">
        {worthIt ? (
          <>
            Best of the next {count}:{" "}
            <span className="font-medium whitespace-nowrap text-ink">
              {best.date === today ? "tonight" : dayName(best, today, "long")}, {best.label} ({best.score})
            </span>
          </>
        ) : (
          "Nothing special this week"
        )}
      </h2>
      <ol className="mt-3 flex gap-1">
        {days.map((day) => (
          <DayColumn key={day.date} day={day} today={today} highlight={worthIt && day === best} />
        ))}
      </ol>
    </section>
  );
}

function DayColumn({ day, today, highlight }: { day: OutlookDay; today: string; highlight: boolean }) {
  const lessSure = day.confidence === "low";
  const isToday = day.date === today;
  return (
    <li
      className={`flex min-w-0 flex-1 flex-col items-center gap-1.5 rounded-xl py-2 text-center ${
        highlight ? "ring-1 ring-white/20" : ""
      }`}
    >
      <span className="sr-only">
        {`${dayName(day, today, "long")}: ${day.score}, ${day.label}. ${day.lookTitle}.${lessSure ? " Less sure." : ""}`}
      </span>
      <span aria-hidden="true" className={`text-xs ${isToday ? "font-medium text-ink" : "text-mist"}`}>
        {dayName(day, today, "short")}
      </span>
      <ScoreRing score={day.score} color={LABEL_COLORS[day.label]} faded={lessSure} />
      <span aria-hidden="true" className="text-[11px] leading-tight text-mist">
        {SHORT_LOOKS[day.look]}
        {lessSure && <span className="mt-0.5 block text-dusk">less sure</span>}
      </span>
    </li>
  );
}

const RING_R = 18;
const RING_LENGTH = 2 * Math.PI * RING_R;

/** A small score dial, tinted by label; faded when the forecast is less sure. */
function ScoreRing({ score, color, faded }: { score: number; color: string; faded: boolean }) {
  return (
    <div className={`relative size-11 shrink-0 ${faded ? "opacity-60" : ""}`} aria-hidden="true">
      <svg viewBox="0 0 44 44" className="size-full -rotate-90">
        <circle cx="22" cy="22" r={RING_R} fill={color} fillOpacity={0.14} stroke="rgba(255,255,255,0.12)" strokeWidth="3.5" />
        {score > 0 && (
          <circle
            cx="22"
            cy="22"
            r={RING_R}
            fill="none"
            stroke={color}
            strokeWidth="3.5"
            strokeLinecap="round"
            strokeDasharray={RING_LENGTH}
            strokeDashoffset={RING_LENGTH * (1 - score / 100)}
          />
        )}
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-sm font-semibold tabular-nums">{score}</span>
    </div>
  );
}

function StripSkeleton() {
  return (
    <div className="animate-pulse rounded-2xl border border-white/10 bg-white/[0.04] p-4" aria-hidden="true">
      <div className="h-4 w-60 max-w-full rounded bg-white/10" />
      <div className="mt-3 flex gap-1">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="flex flex-1 flex-col items-center gap-1.5 py-2">
            <div className="h-4 w-9 rounded bg-white/10" />
            <div className="size-11 rounded-full border-[3.5px] border-white/10" />
            <div className="h-3 w-10 rounded bg-white/10" />
          </div>
        ))}
      </div>
    </div>
  );
}
