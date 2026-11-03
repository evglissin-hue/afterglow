import { compassPoint, roundTo, type LatLon } from "@/lib/geo";
import { nextSunset, type CloudLayer } from "@/lib/sun";
import { WeatherUnavailableError, fetchWeather, type FetchWeatherOptions } from "@/lib/weather/fetch";
import { MODEL_NAMES, type ModelId, type Weather } from "@/lib/weather/openmeteo";
import { sampleLine, scoreEvening } from "./evening";
import {
  LOOKS,
  dominantLayer,
  type Confidence,
  type Factors,
  type Label,
  type Look,
  type Reason,
  type SamplePoint,
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
  const origin = gridPoint(lat, lon);

  const sun = nextSunset(now, origin.lat, origin.lon);
  if (!sun) throw new ForecastError("no-sunset", "The sun doesn't set here today.");

  const coords = sampleLine(origin, sun.bearing);
  const weather = await weatherFor(coords, origin, { fetch: options.fetch });
  const evening = scoreEvening(weather, coords, sun.sunset, now);
  if (!evening) {
    throw new ForecastError("weather-incomplete", "No weather model covers tonight's sunset yet.");
  }

  const { results, combined, shown, leadHours } = evening;
  const layer = dominantLayer(shown.result.factors);
  const window = sun.windows[layer];

  return {
    location: { ...origin, timezone: weather.forecast.timezone },
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

/** A location snapped to the forecast grid. */
export function gridPoint(lat: number, lon: number): LatLon {
  return { lat: roundTo(lat, GRID_DEG), lon: roundTo(lon, GRID_DEG) };
}

/** Weather for the sample points and the observer; a failed request becomes a ForecastError. */
export async function weatherFor(coords: LatLon[], observer: LatLon, options: FetchWeatherOptions): Promise<Weather> {
  try {
    return await fetchWeather(coords, observer, options);
  } catch (error) {
    if (error instanceof WeatherUnavailableError) {
      throw new ForecastError("weather-unavailable", `Weather data unavailable: ${error.message}`);
    }
    throw error;
  }
}
