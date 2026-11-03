import { getForecast, type Forecast } from "@/lib/forecast/getForecast";
import { FORECAST_KEY } from "./forecastCache";
import type { Place } from "./usePlace";

/** How long a saved forecast is fresh enough to show without asking again. */
const CACHE_MS = 30 * 60 * 1000;

/** A forecast, and when it was fetched if it's an older saved copy shown because a refresh failed. */
export type Fetched = { forecast: Forecast; savedAt?: number };

export const placeKey = (p: Place) => `${p.lat.toFixed(1)},${p.lon.toFixed(1)}`;

export async function loadForecast(place: Place): Promise<Fetched> {
  const storageKey = `${FORECAST_KEY}${placeKey(place)}`;
  let cached: { savedAt: number; forecast: Forecast } | null = null;
  try {
    cached = JSON.parse(localStorage.getItem(storageKey) ?? "null");
  } catch {
    // Storage unavailable or corrupt: fetch fresh.
  }
  const now = Date.now();
  const stillTonight = cached !== null && now < Date.parse(cached.forecast.sun.lastLight);
  if (cached && stillTonight && now - cached.savedAt < CACHE_MS) return { forecast: cached.forecast };
  let forecast: Forecast;
  try {
    forecast = await getForecastWithFallback(place);
  } catch (error) {
    // No signal (say, out in a park): an older forecast for tonight beats an error.
    if (cached && stillTonight) return { forecast: cached.forecast, savedAt: cached.savedAt };
    throw error;
  }
  try {
    localStorage.setItem(storageKey, JSON.stringify({ savedAt: Date.now(), forecast }));
  } catch {
    // Private mode or full storage: fine without a cache.
  }
  return { forecast };
}

/**
 * Ask Open-Meteo straight from the browser, so each visitor uses their own free quota.
 * If that fails (e.g. a shared network hit the daily limit), try our server instead.
 */
async function getForecastWithFallback(place: Place): Promise<Forecast> {
  try {
    return await getForecast(place.lat, place.lon);
  } catch (direct) {
    const response = await fetch(`/api/forecast?lat=${place.lat}&lon=${place.lon}`).catch(() => null);
    if (response?.ok) return (await response.json()) as Forecast;
    // The server can read error details the browser can't, so prefer its message.
    const serverError: unknown = await response
      ?.json()
      .then((body: { error?: unknown }) => body.error)
      .catch(() => null);
    throw new Error(typeof serverError === "string" ? serverError : (direct as Error).message);
  }
}

export function friendlyError(message: string): string {
  if (/limit|429/i.test(message)) {
    return "The free weather service has hit its daily limit for this network. Try again later.";
  }
  if (/reach|fetch|network/i.test(message)) {
    return "Couldn't reach the weather service. Check your connection and try again.";
  }
  return message;
}
