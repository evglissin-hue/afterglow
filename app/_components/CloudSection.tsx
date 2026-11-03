"use client";

import { useId } from "react";
import type { SamplePoint } from "@/lib/forecast/score";
import { mix } from "./sky";

const W = 340;
const H = 168;
const GROUND = 128;
const LEFT = 4;
/** Cloud heights: high, mid and low layers, as a band [top, bottom] in px. */
const BANDS = { high: [16, 44], mid: [52, 80], low: [88, 116] } as const;
const LIT = { high: "#f3a6c8", mid: "#f6a15b" } as const;
const UNLIT = "#8d879c";
const LOW = "#9aa7bd";

const union = (a: number, b: number) => 1 - (1 - a) * (1 - b);

/**
 * A side view along tonight's sunset line, from 25 km behind you to 300 km toward the sun: cloud at
 * its height, lit where the light can reach it, and the sun's light coming in from the right.
 */
export function CloudSection({ path, gapBlock }: { path: SamplePoint[]; gapBlock: number }) {
  const id = useId();
  const cell = (W - LEFT) / path.length;
  const center = (i: number) => LEFT + cell * i + cell / 2;
  // How much of the light gets through to light the clouds near you.
  const light = Math.max(0.15, Math.min(1, 1 - gapBlock * 1.15));
  const youX = center(path.findIndex((p) => p.km === 0));

  const near = path.filter((p) => p.km <= 50);
  const far = path.filter((p) => p.km >= 100);
  const avg = (points: SamplePoint[], f: (p: SamplePoint) => number) =>
    points.length ? points.reduce((s, p) => s + f(p), 0) / points.length : 0;
  const canvas = Math.round(avg(near, (p) => union(p.high, p.mid)) * 100);
  const blocking = Math.round(avg(far, (p) => union(p.low, p.mid)) * 100);
  const summary = `Cloud along the sunset line. Near you, about ${canvas}% high and mid cloud to light up. Toward the sun, about ${blocking}% low and mid cloud that can block the light.`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={summary}>
      <defs>
        <linearGradient id={`${id}-ray`} x1="1" y1="0" x2="0" y2="0">
          <stop offset="0" stopColor="#ffd36b" stopOpacity={0.55 * light + 0.1} />
          <stop offset="1" stopColor="#ffd36b" stopOpacity="0" />
        </linearGradient>
        <radialGradient id={`${id}-sun`}>
          <stop offset="0" stopColor="#ffd36b" stopOpacity="0.85" />
          <stop offset="1" stopColor="#ff8a3c" stopOpacity="0" />
        </radialGradient>
        <filter id={`${id}-soft`} x="-20%" y="-50%" width="140%" height="200%">
          <feGaussianBlur stdDeviation="1.6" />
        </filter>
      </defs>

      {/* Light skimming in from the setting sun, beyond the right edge. */}
      {[54, 72, 90].map((y, i) => (
        <path key={y} d={`M${W} ${GROUND - 4} L ${LEFT} ${y + i * 6}`} stroke={`url(#${id}-ray)`} strokeWidth="2" fill="none" />
      ))}
      <circle cx={W - 2} cy={GROUND} r="34" fill={`url(#${id}-sun)`} />
      <circle cx={W - 2} cy={GROUND} r="9" fill="#ffd36b" />

      <g filter={`url(#${id}-soft)`}>
        {path.map((p, i) =>
          (["high", "mid", "low"] as const).map((layer) => {
            const value = p[layer];
            if (value < 0.05) return null;
            const [top, bottom] = BANDS[layer];
            const color =
              layer === "low" ? LOW : p.km <= 50 ? mix(UNLIT, LIT[layer], light) : mix(UNLIT, LIT[layer], 0.25);
            const cx = center(i);
            const w = cell * (0.35 + 0.6 * value);
            const h = (bottom - top) * (0.35 + 0.5 * value);
            const cy = (top + bottom) / 2;
            const opacity = 0.25 + 0.7 * value;
            return (
              <g key={`${p.km}-${layer}`} fill={color} opacity={opacity}>
                <ellipse cx={cx} cy={cy} rx={w / 2} ry={h / 2} />
                <ellipse cx={cx - w * 0.22} cy={cy + h * 0.12} rx={w * 0.3} ry={h * 0.42} />
                <ellipse cx={cx + w * 0.24} cy={cy + h * 0.1} rx={w * 0.28} ry={h * 0.4} />
              </g>
            );
          }),
        )}
      </g>

      <line x1="0" x2={W} y1={GROUND} y2={GROUND} stroke="rgba(255,247,236,0.3)" />
      <circle cx={youX} cy={GROUND - 4} r="4" fill="#5aa9ff" stroke="#fff" strokeWidth="1.5" />

      {path.map((p, i) => (
        <text
          key={p.km}
          x={center(i)}
          y={GROUND + 13}
          textAnchor="middle"
          fontSize="9"
          fill={p.km === 0 ? "#f6efe7" : "#8a8194"}
          fontWeight={p.km === 0 ? 600 : 400}
        >
          {p.km === 0 ? "you" : p.km < 0 ? `−${-p.km}` : p.km}
        </text>
      ))}
      <text x={W - 2} y={GROUND + 13} textAnchor="end" fontSize="9" fill="#8a8194">
        km
      </text>

      <Bracket x0={center(0) - cell / 2 + 2} x1={center(path.findIndex((p) => p.km === 100)) - 2} y={GROUND + 22} text="lights up" />
      <Bracket x0={center(path.findIndex((p) => p.km === 100)) + 2} x1={center(path.length - 1) + cell / 2 - 2} y={GROUND + 22} text="can block the light" />
    </svg>
  );
}

function Bracket({ x0, x1, y, text }: { x0: number; x1: number; y: number; text: string }) {
  return (
    <g>
      <path d={`M${x0} ${y - 4}V${y}H${x1}V${y - 4}`} fill="none" stroke="#8a8194" strokeWidth="1" />
      <text x={(x0 + x1) / 2} y={y + 12} textAnchor="middle" fontSize="9" fill="#b8aebf">
        {text}
      </text>
    </g>
  );
}
