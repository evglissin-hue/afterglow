import { ARCHIVE_CELLS, archiveKindDue, cellKey, eveningDate, type ArchiveKind } from "@/lib/forecast/archive";
import { snapshotOf } from "@/lib/forecast/calibration";
import type { Forecast } from "@/lib/forecast/getForecast";
import type { LatLon } from "@/lib/geo";
import { sunEvents } from "@/lib/sun";
import { ArchiveNotSetUpError, type ArchiveStore } from "./store";

export interface ArchiveDeps {
  store: ArchiveStore;
  /** The forecast for the sunset at `sunset` in a cell, from the weather as known at `now`. */
  forecastFor: (cell: LatLon, sunset: Date, now: Date) => Promise<Forecast>;
  now?: Date;
  cells?: readonly LatLon[];
}

export interface ArchiveSummary {
  /** Copies whose window is open in this run. */
  due: number;
  saved: number;
  errors: string[];
}

const DAY_MS = 86_400_000;

/**
 * One run of the archive job, alongside the alert job every 15 minutes. For each archived cell it
 * keeps the forecast made one to two hours before sunset, and scores that sunset again one to four
 * hours after it. Most runs fall outside both windows and touch neither the weather nor the database.
 */
export async function runArchiveJob(deps: ArchiveDeps): Promise<ArchiveSummary> {
  const now = deps.now ?? new Date();
  const summary: ArchiveSummary = { due: 0, saved: 0, errors: [] };

  const due: { cell: LatLon; sunset: Date; kind: ArchiveKind }[] = [];
  for (const cell of deps.cells ?? ARCHIVE_CELLS) {
    // Today's sunset, and yesterday's for the hours after midnight in summer.
    for (const day of [now, new Date(now.getTime() - DAY_MS)]) {
      const sunset = sunEvents(day, cell.lat, cell.lon)?.sunset;
      const kind = sunset ? archiveKindDue(now, sunset) : null;
      if (sunset && kind) due.push({ cell, sunset, kind });
    }
  }
  summary.due = due.length;

  for (const { cell, sunset, kind } of due) {
    const evening = eveningDate(sunset);
    const cellName = cellKey(cell);
    try {
      if (await deps.store.has(evening, cellName, kind)) continue;
      const forecast = await deps.forecastFor(cell, sunset, now);
      await deps.store.add({ evening, cell: cellName, kind, madeAt: now.toISOString(), snapshot: snapshotOf(forecast) });
      summary.saved++;
    } catch (error) {
      summary.errors.push(`${kind} ${evening} ${cellName}: ${error instanceof Error ? error.message : String(error)}`);
      if (error instanceof ArchiveNotSetUpError) break; // Every other cell would say the same.
    }
  }
  return summary;
}
