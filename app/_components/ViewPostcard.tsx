"use client";

import { useId, useMemo, type ReactNode } from "react";
import { getPosition } from "suncalc";
import { obstacleAt, type ProfileSpec, type Spot } from "@/lib/spots";
import type { SkyPalette } from "./sky";

const W = 342;
const H = 236;
const GROUND = H - 20;
const SPAN = 72;
const MAX_PX_PER_DEG = 13;

const DEFAULT_SKY = ["#2a1450", "#6d2468", "#e5623f", "#ffc061"];
/** Looks with cloud overhead get a few lit streaks. */
const CLOUDY = new Set(["fiery", "pastel", "wholeSky", "golden"]);

/**
 * What you'll see from a spot tonight: its real skyline toward the sunset (from the computed view
 * profile, heights exaggerated) against tonight's sky, with the sun where it slips behind the skyline
 * or sets.
 */
export function ViewPostcard({
  spot,
  profile,
  sunset,
  bearing,
  hidesAt,
  sky,
  look,
  caption,
  thumb = false,
  className = "",
}: {
  spot: Spot;
  profile: ProfileSpec;
  sunset: Date;
  bearing: number;
  hidesAt: Date | null;
  sky?: Pick<SkyPalette, "stops" | "glow"> | null;
  look?: string | null;
  caption?: ReactNode;
  thumb?: boolean;
  className?: string;
}) {
  const id = useId();
  const view = useMemo(() => {
    const last = profile.from + profile.step * (profile.count - 1);
    const lo = Math.min(Math.max(profile.from, bearing - SPAN / 2), last - SPAN);
    const hi = lo + SPAN;
    const inWindow: { b: number; deg: number }[] = [];
    for (let i = 0; i < profile.count; i++) {
      const b = profile.from + i * profile.step;
      if (b >= lo - profile.step && b <= hi + profile.step) inWindow.push({ b, deg: spot.h[i] / 10 });
    }
    const tallest = Math.max(4, ...inWindow.map((p) => p.deg));
    const k = Math.min(MAX_PX_PER_DEG, (GROUND - 40) / tallest);
    const x = (b: number) => ((b - lo) / SPAN) * W;
    const y = (deg: number) => Math.min(H + 2, GROUND - deg * k);
    const skyline = inWindow.map((p) => `${x(p.b).toFixed(1)},${y(p.deg).toFixed(1)}`).join(" ");

    // The sun at the moment it slips behind the skyline, or sitting on the horizon at sunset.
    const moment = hidesAt ?? sunset;
    const at = getPosition(moment, spot.lat, spot.lon);
    const edge = Math.max(0, obstacleAt(spot, at.azimuth, profile) ?? 0);
    const sun = { x: x(at.azimuth), y: y(edge + 0.35) };
    const path: string[] = [];
    for (let t = moment.getTime() - 100 * 60_000; t <= sunset.getTime(); t += 4 * 60_000) {
      const p = getPosition(new Date(t), spot.lat, spot.lon);
      if (p.azimuth >= lo - 4 && p.azimuth <= hi + 4) path.push(`${x(p.azimuth).toFixed(1)},${y(p.altitude).toFixed(1)}`);
    }
    const tick = (b: number, label: string) => (b > lo + 3 && b < hi - 3 ? { x: x(b), label } : null);
    const ticks = [tick(225, "SW"), tick(247.5, "WSW"), tick(270, "W"), tick(292.5, "WNW"), tick(315, "NW")].filter(
      (t): t is { x: number; label: string } => t !== null,
    );
    return { skyline, sun, path: path.join(" "), ticks, exaggeration: k / (W / SPAN) };
  }, [spot, profile, sunset, bearing, hidesAt]);

  const colors = sky ? [sky.stops[0], sky.stops[2], sky.glow[1], sky.glow[0]] : DEFAULT_SKY;
  const box = thumb ? `${Math.min(Math.max(0, view.sun.x - 118), W - 236)} 0 236 ${H}` : `0 0 ${W} ${H}`;

  const figure = (
    <figure className={`relative m-0 overflow-hidden ${thumb ? "rounded-xl" : "rounded-3xl shadow-[0_24px_60px_-28px_rgba(240,138,60,0.55)]"} ${className}`}>
      <svg
        viewBox={box}
        preserveAspectRatio="xMidYMid slice"
        className="block size-full"
        role={thumb ? undefined : "img"}
        aria-hidden={thumb ? true : undefined}
        aria-label={thumb ? undefined : "Tonight's view from this spot toward the sunset, drawn from map data"}
      >
        <defs>
          <linearGradient id={`${id}-sky`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={colors[0]} />
            <stop offset="0.42" stopColor={colors[1]} />
            <stop offset="0.76" stopColor={colors[2]} />
            <stop offset="1" stopColor={colors[3]} />
          </linearGradient>
          <radialGradient id={`${id}-glow`}>
            <stop offset="0" stopColor="#ffe08a" stopOpacity="0.95" />
            <stop offset="0.35" stopColor="#ffb35c" stopOpacity="0.5" />
            <stop offset="1" stopColor="#ff8a3c" stopOpacity="0" />
          </radialGradient>
          <filter id={`${id}-soft`}>
            <feGaussianBlur stdDeviation="3" />
          </filter>
        </defs>
        <rect x="-10" y="0" width={W + 20} height={H} fill={`url(#${id}-sky)`} />
        {look && CLOUDY.has(look) && (
          <g filter={`url(#${id}-soft)`} opacity="0.75">
            <ellipse cx={W * 0.68} cy={H * 0.3} rx="92" ry="6" fill={colors[3]} />
            <ellipse cx={W * 0.86} cy={H * 0.41} rx="70" ry="5" fill={colors[2]} />
            <ellipse cx={W * 0.48} cy={H * 0.48} rx="60" ry="4" fill={colors[3]} />
          </g>
        )}
        <circle cx={view.sun.x} cy={view.sun.y} r="68" fill={`url(#${id}-glow)`} />
        <polyline points={view.path} fill="none" stroke="#ffe08a" strokeWidth="1.5" strokeDasharray="1 4" strokeLinecap="round" opacity="0.8" />
        <circle cx={view.sun.x} cy={view.sun.y} r="9" fill="#ffe08a" />
        <polygon points={`-10,${H} ${view.skyline} ${W + 10},${H}`} fill="#150e1f" />
        <polyline points={view.skyline} fill="none" stroke="#ffb35c" strokeWidth="1" opacity="0.55" />
        {!thumb &&
          view.ticks.map((t) => (
            <text key={t.label} x={t.x} y={H - 5} fontSize="10" fill="#9d93a8" textAnchor="middle">
              {t.label}
            </text>
          ))}
      </svg>
      {caption && <figcaption className="absolute inset-x-4 top-3.5 [text-shadow:0_1px_10px_rgba(0,0,0,0.4)]">{caption}</figcaption>}
    </figure>
  );
  if (thumb) return figure;
  return (
    <div>
      {figure}
      <p className="mt-1.5 text-[11px] leading-relaxed text-dusk">
        Skyline from map data, heights ×{view.exaggeration.toFixed(1)}. The dotted line is the sun&apos;s path.
      </p>
    </div>
  );
}
