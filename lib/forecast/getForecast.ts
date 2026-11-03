import { compassPoint, destination, roundTo, type LatLon } from "@/lib/geo";
import { nextSunset, type CloudLayer } from "@/lib/sun";
import {
  MODELS,
  MODEL_NAMES,
  airQualityUrl,
  forecastUrl,
  hourContaining,
  parseAirQuality,
  parseForecast,
  sumBefore,
  valueAt,
  type AirSeries,
  type ModelId,
  type PointSeries,
} from "@/lib/weather/openmeteo";
import { SAMPLE_KM, config } from "./config";
import {
  LOOKS,
  combineModels,
  dominantLayer,
  scoreSunset,
  type Confidence,
  type Factors,
  type Label,
  type Look,
  type Reason,
  type SamplePoint,
  type ScoreInput,
} from "./score";

/** Forecasts are computed on a grid of this many degrees, so nearby requests share results. */
export const GRID_DEG = 0.1;

export interface Forecast {
  location: LatLon & { timezone: string };
  sun: {
    goldenStart: string;
    sunset: string;
    lastLight: string;
    /** Compass bearing of the setting sun, degrees. */
    bearing: number;
    compass: string;
    bestColor: { start: string; end: string; layer: CloudLayer };
  };
  score: number;
  label: Label;
  look: Look;
  lookTitle: string;
  lookText: string;
  confidence: Confidence;
  /** Highest minus lowest model score. */
  spread: number;
  why: Reason[];
  factors: Factors;
  models: { id: ModelId; name: string; score: number }[];
  /** Cloud along the sunset line from the model shown, fractions 0–1. */
  path: SamplePoint[];
  leadHours: number;
  generatedAt: string;
}

export type ForecastErrorCode = "no-sunset" | "weather-unavailable" | "weather-incomplete";

export class ForecastError extends Error {
  constructor(
    readonly code: ForecastErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ForecastError";
  }
}

interface Options {
  now?: Date;
  fetch?: typeof fetch;
}

/** Tonight's sunset forecast for a location. Works in the browser and on the server. */
export async function getForecast(lat: number, lon: number, options: Options = {}): Promise<Forecast> {
  const now = options.now ?? new Date();
  const doFetch = options.fetch ?? fetch;
  const origin = { lat: roundTo(lat, GRID_DEG), lon: roundTo(lon, GRID_DEG) };

  const sun = nextSunset(now, origin.lat, origin.lon);
  if (!sun) throw new ForecastError("no-sunset", "The sun doesn't set here today.");

  const coords = SAMPLE_KM.map((km) => {
    const p = destination(origin, sun.bearing, km);
    return { lat: roundTo(p.lat, 0.001), lon: roundTo(p.lon, 0.001) };
  });

  const [weather, air] = await Promise.allSettled([
    getJson(doFetch, forecastUrl(coords)),
    getJson(doFetch, airQualityUrl(origin)),
  ]);
  if (weather.status === "rejected") {
    throw new ForecastError("weather-unavailable", `Weather data unavailable: ${messageOf(weather.reason)}`);
  }
  const parsed = parseForecast(weather.value, coords.length);
  const airSeries = air.status === "fulfilled" ? parseAirQuality(air.value) : null;

  const t = sun.sunset.getTime() / 1000 + config.evalOffsetMin * 60;
  const results = MODELS.flatMap((model) => {
    const series = parsed.models[model];
    const input = series ? scoreInputFor(series, coords, airSeries, t) : null;
    return input ? [{ model, result: scoreSunset(input), input }] : [];
  });
  if (results.length === 0) {
    throw new ForecastError("weather-incomplete", "No weather model covers tonight's sunset yet.");
  }

  const leadHours = (sun.sunset.getTime() - now.getTime()) / 3_600_000;
  const combined = combineModels(results, leadHours);
  const shown = results.find((r) => r.model === combined.primary.model)!;
  const layer = dominantLayer(shown.result.factors);
  const window = sun.windows[layer];

  return {
    location: { ...origin, timezone: parsed.timezone },
    sun: {
      goldenStart: sun.goldenStart.toISOString(),
      sunset: sun.sunset.toISOString(),
      lastLight: sun.lastLight.toISOString(),
      bearing: Math.round(sun.bearing),
      compass: compassPoint(sun.bearing),
      bestColor: { start: window.start.toISOString(), end: window.end.toISOString(), layer },
    },
    score: combined.score,
    label: combined.label,
    look: shown.result.look,
    lookTitle: LOOKS[shown.result.look].title,
    lookText: LOOKS[shown.result.look].text,
    confidence: combined.confidence,
    spread: combined.spread,
    why: shown.result.why,
    factors: shown.result.factors,
    models: results.map((r) => ({ id: r.model, name: MODEL_NAMES[r.model], score: r.result.score })),
    path: shown.input.points,
    leadHours: Math.round(leadHours * 10) / 10,
    generatedAt: now.toISOString(),
  };
}

function scoreInputFor(
  series: PointSeries[],
  coords: LatLon[],
  air: AirSeries | null,
  t: number,
): ScoreInput | null {
  const points: SamplePoint[] = [];
  for (let i = 0; i < series.length; i++) {
    const s = series[i];
    const low = valueAt(s.time, s.low, t);
    const mid = valueAt(s.time, s.mid, t);
    const high = valueAt(s.time, s.high, t);
    if (low == null || mid == null || high == null) return null;
    points.push({ km: SAMPLE_KM[i], ...coords[i], low: low / 100, mid: mid / 100, high: high / 100 });
  }

  const here = series[SAMPLE_KM.indexOf(0)];
  const visibility = valueAt(here.time, here.visibility, t);
  return {
    points,
    observer: {
      visibilityKm: visibility == null ? null : visibility / 1000,
      humidity: valueAt(here.time, here.humidity, t),
      rainNow: hourContaining(here.time, here.precipitation, t) ?? 0,
      rainPrev6h: sumBefore(here.time, here.precipitation, t, 6),
      aod: air ? valueAt(air.time, air.aod, t) : null,
    },
  };
}

async function getJson(doFetch: typeof fetch, url: string): Promise<unknown> {
  let response: Response;
  try {
    response = await doFetch(url);
  } catch {
    // Network failure, or a browser hiding an error response that lacks CORS headers.
    throw new Error("couldn't reach the weather service");
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const reason = (body as { reason?: unknown } | null)?.reason;
    throw new Error(typeof reason === "string" ? reason : `HTTP ${response.status}`);
  }
  return body;
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));
