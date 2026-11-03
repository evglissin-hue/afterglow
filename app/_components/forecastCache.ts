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
