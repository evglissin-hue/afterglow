import { config as defaultConfig, type Config } from "./config";
import { clamp, curve, median, smoothstep, union } from "./math";

/** Cloud cover (fractions 0–1) at one point along the sunset line. */
export interface SamplePoint {
  km: number;
  lat: number;
  lon: number;
  low: number;
  mid: number;
  high: number;
}

/** Conditions at the observer's location. */
export interface Observer {
  visibilityKm: number | null;
  humidity: number | null;
  /** Rain in the hour around sunset, mm. */
  rainNow: number;
  /** Rain in the 6 hours before, mm. */
  rainPrev6h: number;
  /** Aerosol optical depth at 550 nm (haze, smoke, dust). */
  aod: number | null;
}

export interface ScoreInput {
  points: SamplePoint[];
  observer: Observer;
}

export type Label = "Poor" | "Fair" | "Good" | "Great" | "Epic";
export type Look = "grey" | "blocked" | "hazy" | "clean" | "wholeSky" | "pastel" | "fiery" | "golden";
export type Confidence = "high" | "medium" | "low";

export interface Factors {
  canvas: number;
  highShare: number;
  lowOver: number;
  gapBlock: number;
  potential: number;
  gap: number;
  lowCloud: number;
  air: number;
  rain: number;
  clearing: boolean;
  aod: number | null;
  visibilityKm: number | null;
  humidity: number | null;
  rainNow: number;
  rainPrev6h: number;
}

export interface Reason {
  text: string;
  tone: "good" | "bad" | "neutral";
}

export interface ScoreResult {
  score: number;
  label: Label;
  look: Look;
  factors: Factors;
  why: Reason[];
}

export const LOOKS: Record<Look, { title: string; text: string }> = {
  grey: { title: "Grey", text: "Low cloud is likely to hide it." },
  blocked: { title: "Blocked", text: "Cloud toward the sunset is likely to block the light." },
  hazy: { title: "Hazy and muted", text: "Soft colors, maybe a red sun disc." },
  clean: { title: "Clean gradient", text: "Orange at the horizon. Turn around for the pink Belt of Venus." },
  wholeSky: { title: "Whole sky glow", text: "Cloud overhead and a clear gap toward the sun: the whole sky can light up." },
  pastel: { title: "Pastel pink and purple", text: "High cloud lit from below after the sun goes down." },
  fiery: { title: "Fiery orange and red", text: "Mid-level cloud catching the last light." },
  golden: { title: "Golden to pink", text: "A mix of cloud layers to catch the light." },
};

type Weights = Config["canvasWeights"] | Config["gapWeights"];

function weightedMean(points: SamplePoint[], weights: Weights, value: (p: SamplePoint) => number) {
  let sum = 0;
  let weightSum = 0;
  for (const [km, w] of weights) {
    const point = points.find((p) => p.km === km);
    if (!point) continue;
    sum += w * value(point);
    weightSum += w;
  }
  return weightSum > 0 ? sum / weightSum : 0;
}

export function labelFor(score: number, cfg: Config = defaultConfig): Label {
  for (const [min, label] of cfg.labels) if (score >= min) return label;
  return "Poor";
}

/** Score one sunset from one weather model's data (SPEC.md §5.4). */
export function scoreSunset(input: ScoreInput, cfg: Config = defaultConfig): ScoreResult {
  const { points, observer } = input;

  const canvas = weightedMean(points, cfg.canvasWeights, (p) => union(p.high, p.mid));
  const high = weightedMean(points, cfg.canvasWeights, (p) => p.high);
  const mid = weightedMean(points, cfg.canvasWeights, (p) => p.mid);
  const highShare = high + mid > 0 ? high / (high + mid) : 0.5;
  const overhead = points.filter((p) => (cfg.lowOverKm as readonly number[]).includes(p.km));
  const lowOver = overhead.length ? overhead.reduce((s, p) => s + p.low, 0) / overhead.length : 0;
  const gapBlock = weightedMean(points, cfg.gapWeights, (p) => union(p.low, p.mid));

  const potential = curve(cfg.potential, canvas);
  const gap = 1 - cfg.gap.max * smoothstep(cfg.gap.from, cfg.gap.to, gapBlock);
  const lowCloud = 1 - cfg.lowCloud.max * smoothstep(cfg.lowCloud.from, cfg.lowCloud.to, lowOver);
  const air = Math.min(
    observer.aod == null ? 1 : curve(cfg.aod, observer.aod),
    observer.visibilityKm == null ? 1 : curve(cfg.visibilityKm, observer.visibilityKm),
    observer.humidity == null ? 1 : curve(cfg.humidity, observer.humidity),
  );
  const rain =
    observer.rainNow >= cfg.rain.heavyMmH
      ? cfg.rain.heavyFactor
      : observer.rainNow >= cfg.rain.lightMmH
        ? cfg.rain.lightFactor
        : 1;
  const clearing =
    observer.rainPrev6h >= cfg.clearing.minPrev6hMm &&
    observer.rainNow < cfg.clearing.maxNowMmH &&
    gapBlock < cfg.clearing.maxGapBlock;

  const score = clamp(
    Math.round(100 * potential * gap * lowCloud * air * rain) + (clearing ? cfg.clearing.bonus : 0),
    0,
    100,
  );

  const factors: Factors = {
    canvas, highShare, lowOver, gapBlock, potential, gap, lowCloud, air, rain, clearing,
    aod: observer.aod,
    visibilityKm: observer.visibilityKm,
    humidity: observer.humidity,
    rainNow: observer.rainNow,
    rainPrev6h: observer.rainPrev6h,
  };

  return {
    score,
    label: labelFor(score, cfg),
    look: lookFor(factors, score, cfg),
    factors,
    why: reasonsFor(factors),
  };
}

/** The likely look: first matching rule wins (SPEC.md §5.5). */
export function lookFor(f: Factors, score: number, cfg: Config = defaultConfig): Look {
  const rules = cfg.look;
  if (f.rainNow >= cfg.rain.heavyMmH || f.lowOver >= rules.greyLowOver) return "grey";
  if (f.gapBlock >= rules.blockedGap) return "blocked";
  if (f.air < rules.hazyAir) return "hazy";
  if (labelFor(score, cfg) === "Poor") {
    // A poor score without one obvious cause: name whatever holds it back most,
    // rather than promising colors that probably won't show.
    const culprits: [Look, number][] = [
      ["grey", Math.min(f.lowCloud, f.rain)],
      ["blocked", f.gap],
      ["hazy", f.air],
    ];
    const [look, value] = culprits.reduce((worst, next) => (next[1] < worst[1] ? next : worst));
    if (value < 0.9) return look;
  }
  if (f.canvas < rules.cleanCanvas) return "clean";
  if (f.canvas >= rules.wholeSkyCanvas && f.gapBlock <= rules.wholeSkyGap) return "wholeSky";
  if (f.highShare >= rules.dominantShare && (f.aod == null || f.aod < rules.pastelMaxAod)) return "pastel";
  if (1 - f.highShare >= rules.dominantShare) return "fiery";
  return "golden";
}

function reasonsFor(f: Factors): Reason[] {
  const why: Reason[] = [];
  const hiddenByLowCloud = f.lowOver >= defaultConfig.look.greyLowOver;

  if (hiddenByLowCloud) {
    // Whatever is above won't be visible, so don't praise it.
  } else if (f.canvas < 0.1) why.push({ text: "Not much cloud to light up", tone: "neutral" });
  else if (f.canvas >= 0.9) why.push({ text: "Thick cloud cover", tone: "bad" });
  else if (f.highShare >= 0.6) why.push({ text: "High cloud to catch the light", tone: "good" });
  else if (f.highShare <= 0.4) why.push({ text: "Mid-level cloud to catch the light", tone: "good" });
  else why.push({ text: "High and mid cloud to catch the light", tone: "good" });

  if (f.gapBlock <= 0.3) why.push({ text: "Clear gap toward the sun", tone: "good" });
  else if (f.gapBlock < 0.6) why.push({ text: "Some cloud toward the sun", tone: "neutral" });
  else why.push({ text: "Cloud bank toward the sunset", tone: "bad" });

  if (f.lowOver >= 0.85) why.push({ text: "Solid low cloud overhead", tone: "bad" });
  else if (f.lowOver >= 0.6) why.push({ text: "Low cloud overhead", tone: "bad" });

  if (f.air < 0.85) why.push({ text: "Hazy air", tone: "bad" });
  else if (f.aod != null && f.aod < 0.15 && (f.visibilityKm == null || f.visibilityKm >= 20)) {
    why.push({ text: "Clean air", tone: "good" });
  }

  if (f.rainNow >= 0.1) why.push({ text: "Rain around sunset", tone: "bad" });
  else if (f.clearing) why.push({ text: "Rain clearing beforehand, often a good sign", tone: "good" });

  return why;
}

export interface ModelResult<M extends string = string> {
  model: M;
  result: ScoreResult;
}

export interface Combined<M extends string = string> {
  score: number;
  label: Label;
  /** The model closest to the median; its look and reasons are shown. */
  primary: ModelResult<M>;
  confidence: Confidence;
  /** Highest minus lowest model score. */
  spread: number;
}

/** Median score across models, with confidence from how much they agree (SPEC.md §5.6). */
export function combineModels<M extends string>(
  results: ModelResult<M>[],
  leadHours: number,
  cfg: Config = defaultConfig,
): Combined<M> {
  if (results.length === 0) throw new Error("No model results to combine");
  const scores = results.map((r) => r.result.score);
  const score = Math.round(median(scores));
  const spread = Math.max(...scores) - Math.min(...scores);

  let primary = results[0];
  for (const r of results) {
    if (Math.abs(r.result.score - score) < Math.abs(primary.result.score - score)) primary = r;
  }

  const levels: Confidence[] = ["high", "medium", "low"];
  let level =
    results.length < 2 ? 2 : spread <= cfg.confidence.highSpread ? 0 : spread <= cfg.confidence.mediumSpread ? 1 : 2;
  if (leadHours > cfg.confidence.longLeadHours) level = Math.min(2, level + 1);

  return { score, label: labelFor(score, cfg), primary, confidence: levels[level], spread };
}

/** Which layer will catch the light, to pick the best color window. */
export function dominantLayer(f: Factors): "high" | "mid" | "clear" {
  if (f.canvas < defaultConfig.look.cleanCanvas) return "clear";
  return f.highShare >= 0.5 ? "high" : "mid";
}
