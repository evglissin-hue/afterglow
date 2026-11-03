import type { LatLon } from "@/lib/geo";
import { nextSunset, sunEvents } from "@/lib/sun";
import { config } from "./config";
import { sampleLine, scoreEvening } from "./evening";
import { ForecastError, gridPoint, weatherFor } from "./getForecast";
import { LOOKS, type Confidence, type Label, type Look } from "./score";

/** One evening of the outlook, scored the way getForecast scores tonight. */
export interface OutlookDay {
  /** The sunset's date in the location's timezone, YYYY-MM-DD. */
  date: string;
  sunset: string;
  score: number;
  label: Label;
  look: Look;
  lookTitle: string;
  confidence: Confidence;
}

export interface Outlook {
  location: LatLon & { timezone: string };
  /**
   * The coming sunsets in order, starting with the one the Tonight screen shows (tomorrow's once
   * tonight's last light has passed). Evenings no weather model reaches yet are left out.
   */
  days: OutlookDay[];
  generatedAt: string;
}

interface Options {
  now?: Date;
  fetch?: typeof fetch;
  /** How many sunsets to score. */
  days?: number;
}

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/**
 * Scores for the next few sunsets at a location, from one weather request and one air-quality
 * request. Works in the browser and on the server.
 */
export async function getOutlook(lat: number, lon: number, options: Options = {}): Promise<Outlook> {
  const now = options.now ?? new Date();
  const count = options.days ?? 5;
  const origin = gridPoint(lat, lon);

  const first = nextSunset(now, origin.lat, origin.lon);
  if (!first) throw new ForecastError("no-sunset", "The sun doesn't set here today.");
  const sunsets = [first.sunset];
  for (let day = 1; day < count; day++) {
    // Days without a sunset (near the poles) are skipped.
    const later = sunEvents(new Date(first.sunset.getTime() + day * DAY_MS), origin.lat, origin.lon);
    if (later) sunsets.push(later.sunset);
  }

  // Every evening is sampled along the first evening's sunset line, so one request covers them all.
  // That's close enough: the bearing moves under 1° a day even in spring and autumn, when it moves
  // fastest (at most 0.64° a day in London). Four days on, the far end of the line, 300 km out, is
  // then at most about 13 km off, far less than cloud forecasts drift that far ahead.
  const coords = sampleLine(origin, first.bearing);
  // From the current hour up to the hour after the last evening's reading, so it can be interpolated.
  const lastReading = sunsets[sunsets.length - 1].getTime() + config.evalOffsetMin * 60_000;
  const forecastHours = Math.ceil((lastReading - now.getTime()) / HOUR_MS) + 2;
  const weather = await weatherFor(coords, origin, { fetch: options.fetch, forecastHours });
  const timezone = weather.forecast.timezone;

  // Air quality (CAMS) only reaches 4–5 days ahead; scoreEvening reads it as missing beyond that,
  // and those evenings are scored without it, as getForecast does when the air request fails.
  const days = sunsets.flatMap((sunset): OutlookDay[] => {
    const evening = scoreEvening(weather, coords, sunset, now);
    if (!evening) return [];
    const { combined, shown } = evening;
    return [
      {
        date: localDate(sunset, timezone),
        sunset: sunset.toISOString(),
        score: combined.score,
        label: combined.label,
        look: shown.result.look,
        lookTitle: LOOKS[shown.result.look].title,
        confidence: combined.confidence,
      },
    ];
  });
  if (days.length === 0) {
    throw new ForecastError("weather-incomplete", "No weather model covers the coming sunsets yet.");
  }

  return { location: { ...origin, timezone }, days, generatedAt: now.toISOString() };
}

/** The calendar date of an instant in a timezone, as YYYY-MM-DD. Uses UTC if the timezone is unknown. */
export function localDate(date: Date, timeZone: string): string {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
