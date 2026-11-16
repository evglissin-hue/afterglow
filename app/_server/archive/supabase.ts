import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { ArchiveKind, ArchivedForecast } from "@/lib/forecast/archive";
import type { ForecastSnapshot } from "@/lib/forecast/calibration";
import { ArchiveNotSetUpError, type ArchiveStore } from "./store";

/** The table created by supabase/schema.sql (step 5). */
const TABLE = "forecast_archive";
const COLUMNS = "evening,cell,kind,made_at,snapshot";
const MAX_ROWS = 1000;

interface Row {
  evening: string;
  cell: string;
  kind: ArchiveKind;
  made_at: string;
  snapshot: ForecastSnapshot;
}

function check<T>(result: { data: T; error: { message: string; code?: string } | null }, what: string): T {
  if (result.error) {
    // Postgres 42P01, or PostgREST's PGRST205: the table isn't there (yet).
    const missing = result.error.code === "42P01" || result.error.code === "PGRST205" || /forecast_archive.*(schema cache|does not exist)/i.test(result.error.message);
    if (missing) throw new ArchiveNotSetUpError();
    throw new Error(`Supabase archive ${what} failed: ${result.error.message}`);
  }
  return result.data;
}

/** Archived forecasts in Supabase Postgres, reached with the service role key (server only). */
export class SupabaseArchive implements ArchiveStore {
  constructor(private readonly db: SupabaseClient) {}

  async has(evening: string, cell: string, kind: ArchiveKind) {
    const data = check(
      await this.db.from(TABLE).select("evening").eq("evening", evening).eq("cell", cell).eq("kind", kind).limit(1),
      "select",
    );
    return (data?.length ?? 0) > 0;
  }

  async add(row: ArchivedForecast) {
    const record = {
      evening: row.evening,
      cell: row.cell,
      kind: row.kind,
      made_at: row.madeAt,
      score: row.snapshot.score,
      formula: row.snapshot.formula ?? null,
      snapshot: row.snapshot,
    };
    check(await this.db.from(TABLE).upsert(record, { onConflict: "evening,cell,kind", ignoreDuplicates: true }), "insert");
  }

  async list(cell: string, sinceEvening: string) {
    const data = check(
      await this.db.from(TABLE).select(COLUMNS).eq("cell", cell).gte("evening", sinceEvening).order("evening").order("kind").limit(MAX_ROWS),
      "list",
    );
    return ((data ?? []) as unknown as Row[]).map((r) => ({
      evening: r.evening,
      cell: r.cell,
      kind: r.kind,
      madeAt: r.made_at,
      snapshot: r.snapshot,
    }));
  }
}

/** `fetch` is for tests, to see the requests without a database. */
export function supabaseArchive(url: string, serviceRoleKey: string, fetch?: typeof globalThis.fetch): ArchiveStore {
  const db = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    ...(fetch ? { global: { fetch } } : {}),
  });
  return new SupabaseArchive(db);
}
