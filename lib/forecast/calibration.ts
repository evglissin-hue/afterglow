import { config as defaultConfig, type Config } from "./config";
import type { Forecast } from "./getForecast";
import { combineModels, scoreSunset, type ScoreInput } from "./score";

/**
 * Checking the score against sunsets people rated (SPEC.md §5.7): what each rating means, the
 * forecast kept with a log, and scoring logged evenings again under the current settings.
 */

/** One line per rating, shown wherever a sunset is rated, so a 3 stays a 3 from evening to evening. */
export const RATINGS = [
  { rating: 1, meaning: "Nothing to see" },
  { rating: 2, meaning: "A little color" },
  { rating: 3, meaning: "Nice, worth a look" },
  { rating: 4, meaning: "Stopped to watch" },
  { rating: 5, meaning: "One to remember" },
] as const;

export const meaningOf = (rating: number): string | null => RATINGS.find((r) => r.rating === rating)?.meaning ?? null;

/** Score bands, lowest first: rating 1 is the first band (Poor), rating 5 the last (Epic). */
function bands(cfg: Config): { min: number; max: number }[] {
  const mins = cfg.labels.map(([min]) => min as number).sort((a, b) => a - b);
  return mins.map((min, i) => ({ min, max: i + 1 < mins.length ? mins[i + 1] - 1 : 100 }));
}

/** The score a rating stands for: the middle of its label's band (3 of 5 is Good, so about 55). */
export function targetScore(rating: number, cfg: Config = defaultConfig): number {
  const all = bands(cfg);
  const band = all[Math.min(all.length, Math.max(1, Math.round(rating))) - 1];
  return Math.round((band.min + band.max) / 2);
}

/** The rating a score predicts: the position of its label, 1 (Poor) to 5 (Epic). */
export function ratingFor(score: number, cfg: Config = defaultConfig): number {
  const all = bands(cfg);
  for (let i = all.length - 1; i >= 0; i--) if (score >= all[i].min) return i + 1;
  return 1;
}

/** The forecast kept with a logged sunset. Older logs have only the first five fields. */
export interface ForecastSnapshot {
  score: number;
  label: string;
  look: string;
  lookTitle?: string;
  confidence?: string;
  /** Which version of the formula gave the score (`config.formula`). */
  formula?: number;
  generatedAt?: string;
  sunset?: string;
  leadHours?: number;
  /** Each model's cloud and air: enough to score the evening again under new settings. */
  inputs?: { model: string; input: ScoreInput }[];
}

const round3 = (x: number) => Math.round(x * 1000) / 1000;
const round3OrNull = (x: number | null) => (x == null ? null : round3(x));

/** What to keep from a forecast when a sunset is logged. Small: three models, eight points each. */
export function snapshotOf(forecast: Forecast): ForecastSnapshot {
  return {
    score: forecast.score,
    label: forecast.label,
    look: forecast.look,
    lookTitle: forecast.lookTitle,
    confidence: forecast.confidence,
    formula: forecast.formula,
    generatedAt: forecast.generatedAt,
    sunset: forecast.sun.sunset,
    leadHours: forecast.leadHours,
    // Forecasts saved before inputs were kept don't have them.
    inputs: forecast.inputs?.map(({ model, input }) => ({
      model,
      input: {
        points: input.points.map((p) => ({
          km: p.km,
          lat: p.lat,
          lon: p.lon,
          low: round3(p.low),
          mid: round3(p.mid),
          high: round3(p.high),
        })),
        observer: {
          visibilityKm: round3OrNull(input.observer.visibilityKm),
          humidity: round3OrNull(input.observer.humidity),
          rainNow: round3(input.observer.rainNow),
          rainPrev6h: round3(input.observer.rainPrev6h),
          aod: round3OrNull(input.observer.aod),
        },
      },
    })),
  };
}

/** The score the current settings give a logged evening. Null when its inputs weren't kept. */
export function rescore(snapshot: ForecastSnapshot | undefined, cfg: Config = defaultConfig): number | null {
  if (!snapshot?.inputs?.length) return null;
  const results = snapshot.inputs.map(({ model, input }) => ({ model, result: scoreSunset(input, cfg) }));
  return combineModels(results, snapshot.leadHours ?? 0, cfg).score;
}

/** A logged evening, as far as checking the score needs it. */
export interface RatedEvening {
  date: string;
  rating: number;
  forecast?: ForecastSnapshot;
}

export interface ReviewRow {
  date: string;
  rating: number;
  /** The score the rating stands for. */
  target: number;
  /** The score shown that evening. */
  then: number;
  /** The score under the settings passed in; null when the inputs weren't kept. */
  now: number | null;
  /** `now` (or `then` without inputs) minus the target: negative means the score undersold the evening. */
  error: number;
}

export interface Review {
  rows: ReviewRow[];
  /** Evenings with a forecast to compare. */
  count: number;
  /** Mean error: negative means the score runs below the ratings. */
  bias: number;
  /** Mean size of the error. */
  meanAbsError: number;
  /** Evenings whose score fell in the band of the rating given. */
  sameBand: number;
}

/**
 * How the score does against rated evenings, scoring each again with `cfg` where its inputs were
 * kept. To tune: change `config.ts`, run this over the same logs, and keep what lowers the error.
 */
export function review(evenings: RatedEvening[], cfg: Config = defaultConfig): Review {
  const rows = evenings
    .filter((e): e is RatedEvening & { forecast: ForecastSnapshot } => Boolean(e.forecast) && e.rating >= 1)
    .map((e) => {
      const now = rescore(e.forecast, cfg);
      const target = targetScore(e.rating, cfg);
      return { date: e.date, rating: e.rating, target, then: e.forecast.score, now, error: (now ?? e.forecast.score) - target };
    });
  const count = rows.length;
  const sum = (values: number[]) => values.reduce((s, v) => s + v, 0);
  return {
    rows,
    count,
    bias: count ? Math.round(sum(rows.map((r) => r.error)) / count) : 0,
    meanAbsError: count ? Math.round(sum(rows.map((r) => Math.abs(r.error))) / count) : 0,
    sameBand: rows.filter((r) => ratingFor(r.now ?? r.then, cfg) === r.rating).length,
  };
}
