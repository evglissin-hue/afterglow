import { distanceKm, type LatLon } from "@/lib/geo";
import type { ForecastSnapshot } from "./calibration";

/**
 * The forecast archive (SPEC.md §5.7): every evening the server keeps the forecast made before
 * sunset and scores the same sunset again afterwards from the newest model runs. Comparing the two
 * tells a weather forecast that changed apart from a formula that misjudged a sky it knew about.
 */

/** Forecast grid cells kept every evening: central London and one cell each way. Public places, no one's home. */
export const ARCHIVE_CELLS: readonly LatLon[] = [
  { lat: 51.5, lon: -0.1 },
  { lat: 51.5, lon: 0 },
  { lat: 51.5, lon: -0.2 },
  { lat: 51.6, lon: -0.1 },
  { lat: 51.4, lon: -0.1 },
];

export type ArchiveKind = "before" | "after";

/** When each copy is made, in minutes from sunset. The job runs every 15 minutes, so each window gets several tries. */
export const ARCHIVE_WINDOWS: Record<ArchiveKind, readonly [number, number]> = {
  before: [-120, -60],
  after: [60, 240],
};

export interface ArchivedForecast {
  /** The evening, YYYY-MM-DD in London. */
  evening: string;
  /** The cell, as `cellKey` writes it. */
  cell: string;
  kind: ArchiveKind;
  madeAt: string;
  snapshot: ForecastSnapshot;
}

export const cellKey = (cell: LatLon) => `${cell.lat.toFixed(1)},${(cell.lon === 0 ? 0 : cell.lon).toFixed(1)}`;

/** The evening a sunset belongs to, as YYYY-MM-DD in London. */
export const eveningDate = (sunset: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(sunset);

/** Which copy, if any, is due at `now` for a sunset at `sunset`. */
export function archiveKindDue(now: Date, sunset: Date): ArchiveKind | null {
  const minutes = (now.getTime() - sunset.getTime()) / 60_000;
  for (const kind of ["before", "after"] as const) {
    const [from, to] = ARCHIVE_WINDOWS[kind];
    if (minutes >= from && minutes < to) return kind;
  }
  return null;
}

/** The archived cell closest to a place. */
export function nearestArchiveCell(place: LatLon): LatLon {
  return ARCHIVE_CELLS.reduce((best, cell) => (distanceKm(place, cell) < distanceKm(place, best) ? cell : best));
}
