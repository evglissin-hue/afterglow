import type { LatLon } from "@/lib/geo";
import {
  airQualityUrl,
  forecastUrl,
  parseAirQuality,
  parseForecast,
  type RequestOptions,
  type Weather,
} from "./openmeteo";

/** The forecast request failed: no connection, or Open-Meteo refused it (say, the daily limit). */
export class WeatherUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WeatherUnavailableError";
  }
}

export interface FetchWeatherOptions extends RequestOptions {
  fetch?: typeof fetch;
}

/**
 * Cloud for every sample point and model (one request) and air quality at the observer (another),
 * fetched in parallel. Throws WeatherUnavailableError if the forecast request fails. Air quality is
 * optional: if its request fails, `air` is null and the score goes without it.
 */
export async function fetchWeather(
  points: LatLon[],
  observer: LatLon,
  options: FetchWeatherOptions = {},
): Promise<Weather> {
  const doFetch = options.fetch ?? fetch;
  const request: RequestOptions = { forecastHours: options.forecastHours };
  const [forecast, air] = await Promise.allSettled([
    getJson(doFetch, forecastUrl(points, request)),
    getJson(doFetch, airQualityUrl(observer, request)),
  ]);
  if (forecast.status === "rejected") throw new WeatherUnavailableError(messageOf(forecast.reason));
  return {
    forecast: parseForecast(forecast.value, points.length),
    air: air.status === "fulfilled" ? parseAirQuality(air.value) : null,
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
