"use client";

import { useId, useMemo } from "react";
import { getPosition } from "suncalc";
import type { Forecast } from "@/lib/forecast/getForecast";

const W = 320;
const H = 96;
const HORIZON = 50;
const PX_PER_DEG = 5;
const STEP_MS = 3 * 60_000;

const BEST_COLOR_HINT = {
  high: "high cloud, after sunset",
  mid: "around sunset",
  clear: "just after sunset",
} as const;

/**
 * The evening at a glance: the sun's height from golden hour to last light, with the best color
 * window and, while it's happening, where the sun is now.
 */
export function SunTimeline({
  forecast,
  now,
  format,
}: {
  forecast: Forecast;
  now: Date | null;
  format: (iso: string) => string;
}) {
  const id = useId();
  const { sun, location } = forecast;

  const geometry = useMemo(() => {
    const start = Date.parse(sun.goldenStart) - 10 * 60_000;
    const end = Date.parse(sun.lastLight) + 5 * 60_000;
    const x = (t: number) => ((t - start) / (end - start)) * W;
    const altitude = (t: number) => getPosition(new Date(t), location.lat, location.lon).altitude;
    const y = (deg: number) => HORIZON - deg * PX_PER_DEG;
    const points: [number, number][] = [];
    for (let t = start; t <= end; t += STEP_MS) points.push([x(t), y(altitude(t))]);
    return { start, end, x, y, altitude, points };
  }, [sun.goldenStart, sun.lastLight, location.lat, location.lon]);

  const t = now?.getTime() ?? null;
  const live = t !== null && t >= geometry.start && t <= geometry.end ? t : null;
  const path = (pts: [number, number][]) => pts.map(([px, py]) => `${px.toFixed(1)},${py.toFixed(1)}`).join(" ");
  const done = live === null ? [] : geometry.points.filter(([px]) => px <= geometry.x(live));
  const sunNow = live === null ? null : { x: geometry.x(live), y: geometry.y(geometry.altitude(live)) };
  const bestX0 = geometry.x(Date.parse(sun.bestColor.start));
  const bestX1 = geometry.x(Date.parse(sun.bestColor.end));
  const sunsetX = geometry.x(Date.parse(sun.sunset));

  const times = [
    { label: "Golden hour", value: format(sun.goldenStart) },
    { label: "Sunset", value: format(sun.sunset) },
    {
      label: "Best color",
      value: `${format(sun.bestColor.start)}–${format(sun.bestColor.end).slice(-2)}`,
      spoken: `${format(sun.bestColor.start)} to ${format(sun.bestColor.end)}`,
      best: true,
    },
    { label: "Last light", value: format(sun.lastLight) },
  ];

  return (
    <section className="rounded-2xl border border-white/10 bg-night/45 p-4" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className="sr-only">
        Tonight&apos;s light
      </h2>
      <svg
        viewBox={`0 -4 ${W} ${H + 4}`}
        className="w-full"
        role="img"
        aria-label={`The sun's height this evening. Golden hour ${format(sun.goldenStart)}, sunset ${format(sun.sunset)}, best color ${format(sun.bestColor.start)} to ${format(sun.bestColor.end)}, last light ${format(sun.lastLight)}.`}
      >
        <defs>
          <linearGradient id={`${id}-band`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#f08a3c" stopOpacity="0.55" />
            <stop offset="1" stopColor="#c2257a" stopOpacity="0.04" />
          </linearGradient>
          <radialGradient id={`${id}-glow`}>
            <stop offset="0" stopColor="#ffd36b" stopOpacity="0.9" />
            <stop offset="1" stopColor="#ffd36b" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect x={bestX0} y={HORIZON} width={Math.max(2, bestX1 - bestX0)} height={H - HORIZON} fill={`url(#${id}-band)`} />
        <line x1="0" x2={W} y1={HORIZON} y2={HORIZON} stroke="rgba(255,247,236,0.35)" />
        <line x1={sunsetX} x2={sunsetX} y1={HORIZON - 6} y2={HORIZON + 6} stroke="#fff7ec" strokeWidth="1.5" />
        <polyline
          points={path(geometry.points)}
          fill="none"
          stroke="rgba(255,211,107,0.45)"
          strokeWidth="2"
          strokeDasharray="2 5"
          strokeLinecap="round"
        />
        {done.length > 1 && <polyline points={path(done)} fill="none" stroke="#ffd36b" strokeWidth="2.5" strokeLinecap="round" />}
        {sunNow && (
          <>
            <circle cx={sunNow.x} cy={sunNow.y} r="16" fill={`url(#${id}-glow)`} />
            <circle cx={sunNow.x} cy={sunNow.y} r="6.5" fill="#ffd36b" />
          </>
        )}
      </svg>
      <dl className="mt-2 grid grid-cols-4 gap-1">
        {times.map((item) => (
          <div key={item.label} className="flex flex-col-reverse">
            <dt className={`text-[11px] ${item.best ? "text-ember" : "text-mist"}`}>{item.label}</dt>
            <dd className={`text-[15px] font-semibold tabular-nums ${item.best ? "text-[#ffb35c]" : ""}`}>
              {item.spoken ? (
                <>
                  <span aria-hidden="true">{item.value}</span>
                  <span className="sr-only">{item.spoken}</span>
                </>
              ) : (
                item.value
              )}
            </dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-xs text-mist">Best color {BEST_COLOR_HINT[sun.bestColor.layer]}.</p>
    </section>
  );
}
