"use client";

import { useEffect, useState } from "react";
import { skyBackground, type skyPalette, type SkyPhase } from "./sky";

/** Star positions, the same on every visit (a fixed seed). */
const STARS = (() => {
  let seed = 7;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  return Array.from({ length: 70 }, () => ({
    x: random() * 100,
    y: random() * 58,
    size: random() < 0.15 ? 2 : 1,
    opacity: 0.35 + random() * 0.6,
    delay: random() * 6,
  }));
})();

/**
 * The sky behind the Tonight screen: tonight's colors, the time of day, stars after dark and a
 * little film grain. It also tints the phone's status bar to match.
 */
export function SkyBackdrop({ sky, phase }: { sky: ReturnType<typeof skyPalette>; phase: SkyPhase }) {
  const background = skyBackground(sky);
  // Keep the previous sky underneath while the new one fades in.
  const [layers, setLayers] = useState({ previous: background, current: background });
  if (layers.current !== background) setLayers({ previous: layers.current, current: background });

  const top = sky.stops[0];
  useEffect(() => {
    const meta = document.querySelector('meta[name="theme-color"]');
    const before = meta?.getAttribute("content");
    meta?.setAttribute("content", top);
    return () => {
      if (before) meta?.setAttribute("content", before);
    };
  }, [top]);

  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div className="absolute inset-0" style={{ background: layers.previous }} />
      <div key={layers.current} className="sky-fade-in absolute inset-0" style={{ background: layers.current }} />
      {phase === "night" && (
        <div className="absolute inset-0">
          {STARS.map((star, i) => (
            <span
              key={i}
              className="star absolute rounded-full bg-white"
              style={{
                left: `${star.x}%`,
                top: `${star.y}%`,
                width: star.size,
                height: star.size,
                opacity: star.opacity,
                animationDelay: `${star.delay}s`,
              }}
            />
          ))}
        </div>
      )}
      <div className="sky-grain absolute inset-0" />
    </div>
  );
}
