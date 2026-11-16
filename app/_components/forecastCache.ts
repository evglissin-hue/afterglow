import type { Forecast } from "@/lib/forecast/getForecast";
import type { LatLon } from "@/lib/geo";

/** Prefix of the forecasts the Tonight screen saves, one per 0.1° cell. */
export const FORECAST_KEY = "afterglow:forecast:";

/**
 * The newest saved forecast for the coming sunset near `near`, if the Tonight screen fetched one
 * recently. Lets other screens use tonight's colors without fetching the weather again.
 */
export function readCachedForecast(near: LatLon, now = Date.now()): Forecast | null {
  let best: { savedAt: number; forecast: Forecast } | null = null;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith(FORECAST_KEY)) continue;
      const entry = JSON.parse(localStorage.getItem(key) ?? "null") as { savedAt: number; forecast: Forecast } | null;
      const location = entry?.forecast?.location;
      if (!entry || !location || now > Date.parse(entry.forecast.sun.lastLight)) continue;
      if (Math.abs(location.lat - near.lat) > 0.15 || Math.abs(location.lon - near.lon) > 0.15) continue;
      if (!best || entry.savedAt > best.savedAt) best = entry;
    }
  } catch {
    return null;
  }
  return best?.forecast ?? null;
}

/** Prefix of the last forecast seen for each evening, kept so a sunset can be logged after dark. */
const EVENING_KEY = "afterglow:evening:";
const KEEP_EVENINGS = 10;

const londonDate = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date(iso));

/**
 * Remembers the newest forecast for its evening. The Tonight cache moves on to tomorrow at last
 * light; this copy stays, so a log made later that night still gets the forecast it was up against.
 */
export function rememberEveningForecast(forecast: Forecast): void {
  try {
    const date = londonDate(forecast.sun.sunset);
    localStorage.setItem(`${EVENING_KEY}${date}`, JSON.stringify(forecast));
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(EVENING_KEY)) keys.push(key);
    }
    for (const key of keys.sort().slice(0, -KEEP_EVENINGS)) localStorage.removeItem(key);
  } catch {
    // Private mode or full storage: logs made after dark go without a forecast.
  }
}

/** The forecast remembered for the evening of `date` (YYYY-MM-DD in London), if it was for near here. */
export function readEveningForecast(date: string, near: LatLon): Forecast | null {
  try {
    const forecast = JSON.parse(localStorage.getItem(`${EVENING_KEY}${date}`) ?? "null") as Forecast | null;
    const location = forecast?.location;
    if (!forecast || !location) return null;
    if (Math.abs(location.lat - near.lat) > 0.15 || Math.abs(location.lon - near.lon) > 0.15) return null;
    return forecast;
  } catch {
    return null;
  }
}
