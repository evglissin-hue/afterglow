import type { ArchiveKind, ArchivedForecast } from "@/lib/forecast/archive";

/** Thrown when the forecast_archive table isn't there yet: supabase/schema.sql needs running again. */
export class ArchiveNotSetUpError extends Error {
  constructor() {
    super("The forecast_archive table is missing: run supabase/schema.sql again.");
    this.name = "ArchiveNotSetUpError";
  }
}

/** Where archived forecasts live: Supabase in production, memory in tests. */
export interface ArchiveStore {
  has(evening: string, cell: string, kind: ArchiveKind): Promise<boolean>;
  /** Keeps the first copy of its kind for an evening and cell; a second one is dropped. */
  add(row: ArchivedForecast): Promise<void>;
  /** A cell's rows from `sinceEvening` (YYYY-MM-DD) on, oldest first. */
  list(cell: string, sinceEvening: string): Promise<ArchivedForecast[]>;
}

export class MemoryArchive implements ArchiveStore {
  readonly rows: ArchivedForecast[] = [];

  async has(evening: string, cell: string, kind: ArchiveKind) {
    return this.rows.some((r) => r.evening === evening && r.cell === cell && r.kind === kind);
  }

  async add(row: ArchivedForecast) {
    if (!(await this.has(row.evening, row.cell, row.kind))) this.rows.push(structuredClone(row));
  }

  async list(cell: string, sinceEvening: string) {
    return this.rows
      .filter((r) => r.cell === cell && r.evening >= sinceEvening)
      .sort((a, b) => a.evening.localeCompare(b.evening) || a.kind.localeCompare(b.kind))
      .map((r) => structuredClone(r));
  }
}
