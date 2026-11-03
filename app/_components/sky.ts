import type { Look } from "@/lib/forecast/score";

/**
 * Sky colors for the Tonight screen: tinted by tonight's likely look and by where the sun is now.
 * The linear stops stay dark enough for white text (at least 4.5:1); the bright part is the glow
 * behind the score, like the sun.
 */
export interface SkyPalette {
  /** Top of the screen down to the middle, all dark enough for white text. */
  stops: [string, string, string, string];
  /** Inner and outer color of the glow behind the score. */
  glow: [string, string];
  /** Score ring gradient. */
  ring: [string, string, string];
}

export type SkyPhase = "day" | "golden" | "glow" | "night";

const LOOK_PALETTES: Record<Look, SkyPalette> = {
  fiery: { stops: ["#120d2a", "#2c1650", "#5e1f5f", "#7a2a55"], glow: ["#ffa64d", "#e85c40"], ring: ["#ffd36b", "#ff8a3c", "#e0457b"] },
  wholeSky: { stops: ["#1a0f38", "#43195f", "#7a2468", "#8e2f5a"], glow: ["#ffb35c", "#f0504f"], ring: ["#ffe08a", "#ff8a3c", "#d6337f"] },
  pastel: { stops: ["#15142e", "#2f2660", "#5a4282", "#6d4a7f"], glow: ["#ffc2dc", "#c48ce0"], ring: ["#ffe0ea", "#f0a6cf", "#a77be0"] },
  golden: { stops: ["#141030", "#33215c", "#5e3366", "#7a3f5e"], glow: ["#ffd27a", "#f0905a"], ring: ["#ffe7a3", "#ffc35c", "#ef8a5a"] },
  clean: { stops: ["#0f1530", "#1f2b5a", "#384078", "#4a4a7e"], glow: ["#ffbe80", "#e8865a"], ring: ["#ffd9a0", "#f5a25c", "#c77dba"] },
  hazy: { stops: ["#17141f", "#2e2533", "#4a3a40", "#5a4242"], glow: ["#e8b080", "#b07a5a"], ring: ["#f0d0a8", "#d79a6a", "#a8735a"] },
  blocked: { stops: ["#12141c", "#1f2330", "#2b3040", "#323646"], glow: ["#a09090", "#605860"], ring: ["#d5dae4", "#a3abba", "#7c8496"] },
  grey: { stops: ["#14161f", "#232838", "#30364a", "#383e52"], glow: ["#b4bccc", "#707890"], ring: ["#d5dae4", "#a3abba", "#7c8496"] },
};

/** What the sky looks like before the forecast arrives. */
const NEUTRAL: SkyPalette = {
  stops: ["#110d24", "#21173f", "#33204f", "#3a2350"],
  glow: ["#c2257a", "#7a2f62"],
  ring: ["#fff7ec", "#fff7ec", "#fff7ec"],
};

/** Each phase blends the look's palette into a base sky by `weight`, and dims the glow by `glow`. */
const PHASES: Record<SkyPhase, { base: SkyPalette["stops"]; weight: number; glow: number }> = {
  day: { base: ["#141a33", "#1c2647", "#26325a", "#2c3860"], weight: 0.5, glow: 0.45 },
  golden: { base: ["#120d2a", "#2c1650", "#4a2058", "#5a2650"], weight: 0.85, glow: 0.85 },
  glow: { base: ["#120d2a", "#2c1650", "#4a2058", "#5a2650"], weight: 1, glow: 1 },
  night: { base: ["#06061a", "#0a0a20", "#100f2a", "#151230"], weight: 0.22, glow: 0.22 },
};

const GOLDEN_LEAD_MS = 45 * 60_000;

/**
 * Where the evening is: daytime, the run-up to sunset, the afterglow, or night (also the time after
 * last light, when the forecast has rolled over to tomorrow). `sunAltitude` is the sun's height now, degrees.
 */
export function skyPhase(
  now: Date,
  sun: { goldenStart: string; sunset: string; lastLight: string },
  sunAltitude: number,
): SkyPhase {
  if (sunAltitude < -6) return "night";
  const t = now.getTime();
  const sunset = Date.parse(sun.sunset);
  if (t > Date.parse(sun.lastLight) || sunset - t > 20 * 3_600_000) return "night";
  if (t >= sunset) return "glow";
  if (t >= Date.parse(sun.goldenStart) - GOLDEN_LEAD_MS) return "golden";
  return "day";
}

export function skyPalette(look: Look | null, phase: SkyPhase): SkyPalette & { glowAlpha: number } {
  const palette = look ? LOOK_PALETTES[look] : NEUTRAL;
  const { base, weight, glow } = PHASES[phase];
  return {
    stops: palette.stops.map((c, i) => mix(base[i], c, weight)) as SkyPalette["stops"],
    glow: palette.glow,
    ring: palette.ring,
    glowAlpha: look ? glow : glow * 0.6,
  };
}

/** The CSS background for the whole screen: the sky fades into the app's night color below the fold. */
export function skyBackground(sky: ReturnType<typeof skyPalette>): string {
  const [inner, outer] = sky.glow;
  const a = sky.glowAlpha;
  const [s0, s1, s2, s3] = sky.stops;
  return [
    `radial-gradient(75% 26% at 50% 21%, ${rgba(inner, 0.78 * a)} 0%, ${rgba(outer, 0.42 * a)} 45%, ${rgba(outer, 0)} 100%)`,
    `linear-gradient(180deg, ${s0} 0%, ${s1} 14%, ${s2} 30%, ${s3} 42%, #0d0b14 72%)`,
  ].join(", ");
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Blend from `a` (weight 0) to `b` (weight 1). */
export function mix(a: string, b: string, weight: number): string {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  return `#${x.map((v, i) => Math.round(v + (y[i] - v) * weight).toString(16).padStart(2, "0")).join("")}`;
}

export function rgba(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${Math.round(alpha * 1000) / 1000})`;
}
