import type { LatLon } from "@/lib/geo";

/**
 * Weather models used for the score. All three give low, mid and high cloud for London
 * (checked 3 Nov 2026). Open-Meteo's `best_match` is UKMO for the UK, so it isn't added again.
 */
export const MODELS = ["ukmo_seamless", "ecmwf_ifs", "icon_seamless"] as const;
export type ModelId = (typeof MODELS)[number];

export const MODEL_NAMES: Record<ModelId, string> = {
  ukmo_seamless: "UK Met Office",
  ecmwf_ifs: "ECMWF",
  icon_seamless: "DWD ICON",
};

const HOURLY = [
  "cloud_cover_low",
  "cloud_cover_mid",
  "cloud_cover_high",
  "visibility",
  "relative_humidity_2m",
  "precipitation",
] as const;
type HourlyVariable = (typeof HOURLY)[number];

// Unix times avoid timezone parsing; 7 past hours cover "rain in the last 6 h",
// and 36 ahead reach tomorrow's sunset once today's has passed.
const COMMON = { timeformat: "unixtime", timezone: "auto", past_hours: "7", forecast_hours: "36" };

/** One request for every sample point and every model. */
export function forecastUrl(points: LatLon[]): string {
  const params = new URLSearchParams({
    latitude: points.map((p) => p.lat.toFixed(3)).join(","),
    longitude: points.map((p) => p.lon.toFixed(3)).join(","),
    hourly: HOURLY.join(","),
    models: MODELS.join(","),
    ...COMMON,
  });
  return `https://api.open-meteo.com/v1/forecast?${params}`;
}

export function airQualityUrl(point: LatLon): string {
  const params = new URLSearchParams({
    latitude: point.lat.toFixed(3),
    longitude: point.lon.toFixed(3),
    hourly: "aerosol_optical_depth",
    ...COMMON,
  });
  return `https://air-quality-api.open-meteo.com/v1/air-quality?${params}`;
}

export type Series = (number | null)[];

interface RawLocation {
  timezone?: string;
  hourly?: { time?: number[] } & Record<string, Series | undefined>;
}

/** Hourly data from one model at one sample point. Cloud cover in %, visibility in m. */
export interface PointSeries {
  time: number[];
  low: Series;
  mid: Series;
  high: Series;
  visibility: Series;
  humidity: Series;
  precipitation: Series;
}

export interface ParsedForecast {
  timezone: string;
  /** Per model, one series per sample point, in request order. Models with gaps are left out. */
  models: Partial<Record<ModelId, PointSeries[]>>;
}

export function parseForecast(json: unknown, pointCount: number): ParsedForecast {
  const locations = (Array.isArray(json) ? json : [json]) as RawLocation[];
  if (locations.length !== pointCount) {
    throw new Error(`Expected ${pointCount} locations from Open-Meteo, got ${locations.length}`);
  }
  const models: ParsedForecast["models"] = {};
  for (const model of MODELS) {
    const series = locations.map((location) => seriesFor(location, model));
    if (series.every((s): s is PointSeries => s !== null)) models[model] = series;
  }
  return { timezone: locations[0]?.timezone ?? "UTC", models };
}

function seriesFor(location: RawLocation, model: ModelId): PointSeries | null {
  const hourly = location.hourly;
  if (!hourly?.time) return null;
  const get = (variable: HourlyVariable) => hourly[`${variable}_${model}`] ?? null;
  const low = get("cloud_cover_low");
  const mid = get("cloud_cover_mid");
  const high = get("cloud_cover_high");
  if (!low || !mid || !high) return null;
  const empty: Series = hourly.time.map(() => null);
  return {
    time: hourly.time,
    low,
    mid,
    high,
    visibility: get("visibility") ?? empty,
    humidity: get("relative_humidity_2m") ?? empty,
    precipitation: get("precipitation") ?? empty,
  };
}

export interface AirSeries {
  time: number[];
  aod: Series;
}

export function parseAirQuality(json: unknown): AirSeries | null {
  const hourly = (json as RawLocation | null)?.hourly;
  const aod = hourly?.aerosol_optical_depth;
  return hourly?.time && aod ? { time: hourly.time, aod } : null;
}

/** Linear interpolation of an hourly series at unix time `t` (seconds). */
export function valueAt(time: number[], values: Series, t: number): number | null {
  for (let i = 0; i < time.length - 1; i++) {
    if (t < time[i] || t > time[i + 1]) continue;
    const a = values[i];
    const b = values[i + 1];
    if (a == null || b == null) return a ?? b ?? null;
    return a + ((b - a) * (t - time[i])) / (time[i + 1] - time[i]);
  }
  return null;
}

/** Open-Meteo precipitation is the total over the preceding hour; this is the hour containing `t`. */
export function hourContaining(time: number[], values: Series, t: number): number | null {
  const i = time.findIndex((x) => x >= t);
  return i >= 0 ? values[i] : null;
}

/** Total of the hourly values whose hour ends within (t − hours, t]. */
export function sumBefore(time: number[], values: Series, t: number, hours: number): number {
  let total = 0;
  time.forEach((x, i) => {
    if (x > t - hours * 3600 && x <= t) total += values[i] ?? 0;
  });
  return total;
}
