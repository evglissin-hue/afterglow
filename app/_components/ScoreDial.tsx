"use client";

import { useEffect, useId, useState, type CSSProperties } from "react";

const RADIUS = 66;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const COUNT_MS = 1100;

/**
 * Tonight's score as a glowing ring, like a low sun: it fills and counts up when it appears, and
 * pulses gently on Epic nights.
 */
export function ScoreDial({
  score,
  label,
  ring,
  glow,
}: {
  score: number;
  label: string;
  ring: [string, string, string];
  glow: string;
}) {
  const gradientId = useId();
  const [shown, setShown] = useState(0);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const id = requestAnimationFrame(() => setShown(score));
      return () => cancelAnimationFrame(id);
    }
    let frame = 0;
    const start = performance.now();
    const step = (t: number) => {
      const p = Math.min(1, (t - start) / COUNT_MS);
      setShown(Math.round(score * (1 - (1 - p) ** 3)));
      if (p < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [score]);

  const style = { filter: `drop-shadow(0 0 16px ${glow})`, "--score-glow": glow } as CSSProperties;

  return (
    <div className="relative size-39 shrink-0" role="img" aria-label={`Sunset score ${score} out of 100: ${label}`}>
      <svg viewBox="0 0 156 156" className={`size-full -rotate-90 ${label === "Epic" ? "score-pulse" : ""}`} style={style} aria-hidden="true">
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={ring[0]} />
            <stop offset="0.55" stopColor={ring[1]} />
            <stop offset="1" stopColor={ring[2]} />
          </linearGradient>
        </defs>
        <circle cx="78" cy="78" r={RADIUS} fill="none" stroke="rgba(255,255,255,0.16)" strokeWidth="10" />
        <circle
          cx="78"
          cy="78"
          r={RADIUS}
          fill="none"
          stroke={`url(#${gradientId})`}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={CIRCUMFERENCE * (1 - shown / 100)}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center" aria-hidden="true">
        <span className="text-[54px] leading-none font-semibold tracking-tight tabular-nums">{shown}</span>
        <span className="mt-1.5 text-xs font-semibold tracking-[0.18em] uppercase">{label}</span>
      </div>
    </div>
  );
}
