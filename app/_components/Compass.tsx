"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Camera, CameraOff, Compass as CompassIcon, MapPin } from "lucide-react";
import { getPosition } from "suncalc";
import { compassPoint } from "@/lib/geo";
import { FACING_TOLERANCE, angleDiff, compassWords, turnToward, type Turn } from "@/lib/compass";
import { SUN_UP_ALTITUDE, nextSunset, sunPath, type SunPosition } from "@/lib/sun";
import { CameraView } from "./CameraView";
import { timeFormatter } from "./spotStyle";
import { useHeading, type CompassStatus } from "./useHeading";
import { usePlace, type Place } from "./usePlace";

type View = "dial" | "camera";

/** Tonight's sun, as the compass shows it. */
export interface Sky {
  sunset: Date;
  /** Compass bearing of the sunset, degrees. */
  bearing: number;
  /** Where the sun is now, while it's up. */
  sun: { azimuth: number; altitude: number } | null;
  /** The sun's path from now to sunset, while it's up. */
  path: SunPosition[];
}

const LONDON_TIME = "Europe/London";
/** A short buzz when you line up with the sunset, ms. */
const TICK_MS = 30;
/** After a buzz, turn this far away before the next one, so a jittery compass doesn't buzz again. */
const REARM_DEG = 15;

function skyAt(now: Date, place: Place): Sky | null {
  const events = nextSunset(now, place.lat, place.lon);
  if (!events) return null;
  const sun = getPosition(now, place.lat, place.lon);
  return {
    sunset: events.sunset,
    bearing: events.bearing,
    sun: sun.altitude > SUN_UP_ALTITUDE ? sun : null,
    path: sunPath(now, events.sunset, place.lat, place.lon).filter((p) => p.altitude > -1),
  };
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

/** A short buzz when you first line up with the sunset (where phones can vibrate). */
function useLineUpTick(facing: boolean, offBy: number | null) {
  const armed = useRef(true);
  useEffect(() => {
    if (facing && armed.current) {
      armed.current = false;
      if ("vibrate" in navigator) navigator.vibrate(TICK_MS);
    } else if (!facing && (offBy === null || offBy > REARM_DEG)) {
      armed.current = true;
    }
  }, [facing, offBy]);
}

const deviceTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || LONDON_TIME;

const turnText = (turn: Turn) =>
  turn.direction === "ahead" ? "You're facing the sunset" : `Turn ${turn.direction} ${turn.degrees}°`;

const bearingText = (bearing: number) => `${Math.round(bearing) % 360}° ${compassPoint(bearing)}`;

const dayKey = (date: Date, timeZone: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);

/** "Sunset 16:28 toward 246° WSW" */
function sunsetLine(sky: Sky, now: Date, timeZone: string): string {
  const time = timeFormatter(timeZone)(sky.sunset);
  const toward = `toward ${bearingText(sky.bearing)}`;
  if (sky.sunset.getTime() <= now.getTime()) return `The sun set at ${time}, ${toward}`;
  const tomorrow = dayKey(sky.sunset, timeZone) !== dayKey(now, timeZone);
  return `Sunset ${tomorrow ? "tomorrow " : ""}${time} ${toward}`;
}

/** Which way to face without a compass, using the sun as a landmark when it's up. */
function faceHint(sky: Sky): string {
  const degrees = `That's ${Math.round(sky.bearing) % 360}° from north`;
  if (!sky.sun) return `${degrees}.`;
  const fromSun = angleDiff(sky.sun.azimuth, sky.bearing);
  const off = Math.round(Math.abs(fromSun));
  if (off <= FACING_TOLERANCE) return `${degrees}, where the sun is now.`;
  return `${degrees}, about ${off}° to the ${fromSun > 0 ? "right" : "left"} of the sun.`;
}

const WHY_NO_COMPASS: Partial<Record<CompassStatus, string>> = {
  denied: "Compass access is off, so north is up on the dial.",
  unavailable: "No compass found, so north is up on the dial.",
};

/** Turn to face tonight's sunset: a compass dial that turns with the phone, or the camera with the sunset marked. */
export default function Compass() {
  const { place } = usePlace();
  const now = useNow();
  const { status, pose, start } = useHeading();
  const [view, setView] = useState<View>("dial");
  const [cameraProblem, setCameraProblem] = useState<string | null>(null);
  const [facing, setFacing] = useState(false);

  const sky = useMemo(() => (now && place ? skyAt(now, place) : null), [now, place]);
  const timeZone = place?.source === "device" ? deviceTimeZone() : LONDON_TIME;
  const line = useMemo(() => (sky && now ? sunsetLine(sky, now, timeZone) : null), [sky, now, timeZone]);

  const livePose = status === "live" ? pose : null;
  const inCamera = view === "camera" && livePose !== null && sky !== null;
  // The dial goes by where you face; the camera view by where the camera looks.
  const heading = livePose && (inCamera ? (livePose.cameraHeading ?? livePose.heading) : livePose.heading);
  const turn = heading !== null && sky ? turnToward(heading, sky.bearing, facing) : null;
  const isFacing = turn?.direction === "ahead";
  if (isFacing !== facing) setFacing(isFacing);
  useLineUpTick(isFacing, turn?.degrees ?? null);

  const choose = (next: View) => {
    setCameraProblem(null);
    setView(next);
  };
  const closeCamera = useCallback(() => setView("dial"), []);
  const cameraFailed = useCallback((message: string) => {
    setCameraProblem(message);
    setView("dial");
  }, []);

  const toggle = (overlay: boolean) => (
    <ViewToggle view={inCamera ? "camera" : "dial"} onChange={choose} overlay={overlay} />
  );

  return (
    <>
      <main
        inert={inCamera}
        className="mx-auto flex w-full max-w-md flex-1 flex-col px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))]"
      >
        <Link
          href="/"
          className="-ml-2 inline-flex min-h-11 items-center gap-1.5 self-start rounded-full px-2 text-sm text-mist hover:text-ink"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Back to tonight
        </Link>

        <header className="mt-1">
          <h1 className="text-2xl font-semibold tracking-tight">Sunset compass</h1>
          <p className="mt-1 text-mist">
            {line ?? (place && now ? "The sun doesn't set here today." : "Finding you…")}
          </p>
          {place && (
            <p className="mt-0.5 flex items-center gap-1.5 text-xs text-dusk">
              <MapPin className="size-3.5" aria-hidden="true" />
              {place.source === "device" ? "From where you are" : "From central London"}
            </p>
          )}
        </header>

        <Dial heading={livePose?.heading ?? null} sky={sky} facing={isFacing && !inCamera} />
        <Legend sky={sky} />
        {/* Right under the dial, so it's on screen even on a small iPhone. */}
        {status === "needs-permission" && (
          <button
            type="button"
            onClick={() => void start()}
            className="mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-full bg-ember text-base font-semibold text-night hover:brightness-110"
          >
            <CompassIcon className="size-5" aria-hidden="true" />
            Start compass
          </button>
        )}
        <Guidance status={status} turn={turn} heading={livePose?.heading ?? null} sky={sky} />

        <div className="mt-5 space-y-3">
          {livePose && sky && toggle(false)}
          {cameraProblem && (
            <p
              role="alert"
              className="flex items-start gap-2.5 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-mist"
            >
              <CameraOff className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              {cameraProblem}
            </p>
          )}
        </div>

        <p className="mt-auto pt-8 text-xs leading-relaxed text-dusk">
          Phone compasses can be 10–20° off in a city, near steel, cars and buildings. Check against the sun or a map.
        </p>
      </main>

      <p className="sr-only" role="status">
        {isFacing ? "You're facing the sunset" : ""}
      </p>

      {inCamera && livePose && sky && (
        <CameraView
          pose={livePose}
          sky={sky}
          guidance={turn ? turnText(turn) : ""}
          facing={isFacing}
          sunsetLine={line ?? ""}
          timeZone={timeZone}
          onClose={closeCamera}
          onProblem={cameraFailed}
        >
          {toggle(true)}
        </CameraView>
      )}
    </>
  );
}

function Guidance({
  status,
  turn,
  heading,
  sky,
}: {
  status: CompassStatus;
  turn: Turn | null;
  heading: number | null;
  sky: Sky | null;
}) {
  if (!sky) return <div className="mt-5 min-h-24" />;
  if (status === "live" && turn && heading !== null) {
    return (
      <div className="mt-5 min-h-24 text-center">
        <p
          className={`text-[2rem] leading-tight font-semibold tracking-tight text-balance ${
            turn.direction === "ahead" ? "text-ember" : "text-ink"
          }`}
        >
          {turnText(turn)}
        </p>
        <p className="mt-1.5 text-sm text-mist">Pointing {bearingText(heading)}</p>
      </div>
    );
  }
  if (status === "starting") {
    return <p className="mt-5 min-h-24 text-center text-xl text-mist">Finding north…</p>;
  }
  return (
    <div className="mt-5 min-h-24 text-center">
      <p className="text-[2rem] leading-tight font-semibold tracking-tight text-balance">
        Face <span className="whitespace-nowrap">{compassWords(sky.bearing)}</span>
      </p>
      <p className="mt-1.5 text-sm text-mist">{faceHint(sky)}</p>
      {WHY_NO_COMPASS[status] && <p className="mt-1 text-sm text-dusk">{WHY_NO_COMPASS[status]}</p>}
    </div>
  );
}

function ViewToggle({ view, onChange, overlay }: { view: View; onChange: (view: View) => void; overlay: boolean }) {
  const options = [
    { id: "dial", label: "Dial", Icon: CompassIcon },
    { id: "camera", label: "Camera", Icon: Camera },
  ] as const;
  return (
    <div
      role="group"
      aria-label="View"
      className={`grid grid-cols-2 gap-1 rounded-full border p-1 ${
        overlay ? "border-white/15 bg-black/50 backdrop-blur-md" : "border-white/10 bg-white/[0.05]"
      }`}
    >
      {options.map(({ id, label, Icon }) => {
        const active = view === id;
        return (
          <button
            key={id}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(id)}
            className={`flex h-12 items-center justify-center gap-2 rounded-full text-base font-medium transition-colors motion-reduce:transition-none ${
              active ? "bg-ink text-night" : overlay ? "text-white/85 hover:text-white" : "text-mist hover:text-ink"
            }`}
          >
            <Icon className="size-[18px]" aria-hidden="true" />
            {label}
          </button>
        );
      })}
    </div>
  );
}

function Legend({ sky }: { sky: Sky | null }) {
  if (!sky) return null;
  return (
    <p className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-mist" aria-hidden="true">
      <span className="flex items-center gap-1.5">
        <span className="size-2.5 rounded-full bg-[#ffc35c] shadow-[0_0_8px_2px_rgba(255,195,92,0.55)]" />
        Sunset
      </span>
      {sky.sun && (
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-[#fff1c9]" />
          Sun now
        </span>
      )}
      {sky.path.length > 1 && (
        <span className="flex items-center gap-1.5">
          <span className="flex gap-0.5">
            <span className="size-1 rounded-full bg-[#ffc35c]" />
            <span className="size-1 rounded-full bg-[#ffc35c]" />
            <span className="size-1 rounded-full bg-[#ffc35c]" />
          </span>
          Sun&apos;s path
        </span>
      )}
    </p>
  );
}

const DIAL = 320;
const C = DIAL / 2;
const RIM = 148;
const SUN_R = 112;
const LABEL_R = 80;
const WEDGE_R = 128;

/**
 * A point `r` from the dial's centre toward `bearing`, with north up. Rounded to 0.01, because the server and the
 * browser can disagree on the last digit of a sine, and the dial is drawn on both.
 */
function polar(bearing: number, r: number) {
  const a = (bearing * Math.PI) / 180;
  const round = (v: number) => Math.round(v * 100) / 100;
  return { x: round(C + r * Math.sin(a)), y: round(C - r * Math.cos(a)) };
}

const TICKS = Array.from({ length: 72 }, (_, i) => {
  const bearing = i * 5;
  const size = bearing % 90 === 0 ? 3 : bearing % 30 === 0 ? 2 : bearing % 10 === 0 ? 1 : 0;
  return { bearing, size, outer: polar(bearing, RIM - 5), inner: polar(bearing, RIM - 5 - [4, 7, 11, 14][size]) };
});

const CARDINALS = [
  { label: "N", bearing: 0 },
  { label: "E", bearing: 90 },
  { label: "S", bearing: 180 },
  { label: "W", bearing: 270 },
];

/**
 * A compass dial that turns with the phone so north stays north, with tonight's sunset as a glowing sun, the sun
 * now and its path. The mark at the top is where you face. Without a heading it sits still with north up.
 */
function Dial({ heading, sky, facing }: { heading: number | null; sky: Sky | null; facing: boolean }) {
  const turn = heading ?? 0;
  const sunset = sky ? polar(sky.bearing, SUN_R) : null;
  const sun = sky?.sun ? polar(sky.sun.azimuth, SUN_R) : null;
  const path =
    sky && sky.path.length > 1
      ? sky.path
          .map((p) => {
            const q = polar(p.azimuth, SUN_R);
            return `${q.x.toFixed(1)},${q.y.toFixed(1)}`;
          })
          .join(" ")
      : null;
  let wedge: string | null = null;
  if (sky) {
    const from = polar(sky.bearing - FACING_TOLERANCE, WEDGE_R);
    const to = polar(sky.bearing + FACING_TOLERANCE, WEDGE_R);
    wedge = `M ${C} ${C} L ${from.x} ${from.y} A ${WEDGE_R} ${WEDGE_R} 0 0 1 ${to.x} ${to.y} Z`;
  }
  const label = !sky
    ? "Compass dial"
    : heading === null
      ? `Compass dial with north up. The sunset is at ${bearingText(sky.bearing)}.`
      : `Compass dial. You're facing ${bearingText(heading)}. The sunset is at ${bearingText(sky.bearing)}.`;

  return (
    <div className="relative mx-auto mt-4 aspect-square w-[min(100%,22rem,42dvh)]">
      <div
        aria-hidden="true"
        className={`absolute inset-[4%] rounded-full bg-ember/35 blur-2xl transition-opacity duration-500 motion-reduce:transition-none ${
          facing ? "opacity-100 motion-safe:animate-pulse" : "opacity-0"
        }`}
      />
      <svg viewBox={`0 0 ${DIAL} ${DIAL}`} className="relative size-full" role="img" aria-label={label}>
        <defs>
          <radialGradient id="compass-face" cx="50%" cy="38%" r="70%">
            <stop offset="0" stopColor="#261d33" />
            <stop offset="1" stopColor="#110e18" />
          </radialGradient>
          <radialGradient id="compass-sunset-glow">
            <stop offset="0" stopColor="#ffc35c" stopOpacity="0.9" />
            <stop offset="0.45" stopColor="#f08a3c" stopOpacity="0.35" />
            <stop offset="1" stopColor="#f08a3c" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="compass-sun-glow">
            <stop offset="0" stopColor="#fff1c9" stopOpacity="0.7" />
            <stop offset="1" stopColor="#fff1c9" stopOpacity="0" />
          </radialGradient>
        </defs>

        <circle
          cx={C}
          cy={C}
          r={RIM}
          fill="url(#compass-face)"
          stroke={facing ? "#f08a3c" : "rgba(246,239,231,0.22)"}
          strokeWidth="2"
        />

        <g transform={`rotate(${(-turn).toFixed(2)} ${C} ${C})`}>
          {TICKS.map((t) => (
            <line
              key={t.bearing}
              x1={t.outer.x}
              y1={t.outer.y}
              x2={t.inner.x}
              y2={t.inner.y}
              stroke={t.bearing === 0 ? "#f59f8b" : t.size >= 2 ? "rgba(246,239,231,0.6)" : "rgba(246,239,231,0.28)"}
              strokeWidth={[1, 1.25, 2, 3][t.size]}
              strokeLinecap="round"
            />
          ))}
          {wedge && <path d={wedge} fill="rgba(240,138,60,0.16)" />}
          {sunset && (
            <line
              x1={C}
              y1={C}
              x2={sunset.x}
              y2={sunset.y}
              stroke="rgba(255,195,92,0.55)"
              strokeWidth="2"
              strokeDasharray="1 6"
              strokeLinecap="round"
            />
          )}
          {path && (
            <polyline
              points={path}
              fill="none"
              stroke="#ffc35c"
              strokeOpacity="0.75"
              strokeWidth="3"
              strokeDasharray="0.1 8"
              strokeLinecap="round"
            />
          )}
          {sun && (
            <g>
              <circle cx={sun.x} cy={sun.y} r="16" fill="url(#compass-sun-glow)" />
              <circle cx={sun.x} cy={sun.y} r="6" fill="#fff1c9" />
            </g>
          )}
          {sunset && (
            <g>
              <circle cx={sunset.x} cy={sunset.y} r="30" fill="url(#compass-sunset-glow)" />
              <circle cx={sunset.x} cy={sunset.y} r="11" fill="#ffc35c" stroke="#0d0b14" strokeWidth="2" />
            </g>
          )}
          {CARDINALS.map(({ label, bearing }) => {
            const p = polar(bearing, LABEL_R);
            return (
              <text
                key={label}
                x={p.x}
                y={p.y}
                transform={`rotate(${turn.toFixed(2)} ${p.x} ${p.y})`}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={bearing === 0 ? 24 : 20}
                fontWeight="600"
                fill={bearing === 0 ? "#f6efe7" : "#b8aebf"}
              >
                {label}
              </text>
            );
          })}
        </g>

        {heading !== null && (
          <g>
            <line x1={C} y1={28} x2={C} y2={C - 16} stroke="rgba(246,239,231,0.22)" strokeWidth="1.5" />
            <path d={`M ${C - 10} 1 L ${C + 10} 1 L ${C} 21 Z`} fill={facing ? "#f08a3c" : "#f6efe7"} />
          </g>
        )}
        <circle cx={C} cy={C} r="4" fill="#f6efe7" />
      </svg>
    </div>
  );
}
