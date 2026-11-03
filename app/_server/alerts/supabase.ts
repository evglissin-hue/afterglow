import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  DEFAULT_ALERT_SETTINGS,
  cleanFavorites,
  parseAlertSettings,
  type AlertGuard,
  type AlertState,
} from "@/lib/alerts";
import type { StoredSubscription, SubscriptionInput, SubscriptionStore } from "./store";

/** The table created by supabase/schema.sql. */
const TABLE = "push_subscriptions";

interface Row {
  endpoint: string;
  p256dh: string;
  auth: string;
  lat: number;
  lon: number;
  walk_minutes: number;
  min_label: string;
  lead_minutes: number;
  happening_now: boolean;
  upgrades: boolean;
  favorites: unknown;
  timezone: string;
  last_ok_at: string | null;
  last_test_at: string | null;
  decided_on: string | null;
  decided_score: number | null;
  sent_on: string | null;
  sent_kind: AlertState["sentKind"];
  now_checked_on: string | null;
  now_sent_on: string | null;
}

const COLUMNS =
  "endpoint,p256dh,auth,lat,lon,walk_minutes,min_label,lead_minutes,happening_now,upgrades,favorites,timezone," +
  "last_ok_at,last_test_at,decided_on,decided_score,sent_on,sent_kind,now_checked_on,now_sent_on";

const STATE_COLUMNS = {
  decidedOn: "decided_on",
  decidedScore: "decided_score",
  sentOn: "sent_on",
  sentKind: "sent_kind",
  nowCheckedOn: "now_checked_on",
  nowSentOn: "now_sent_on",
} as const satisfies Record<keyof AlertState, keyof Row>;

const PAGE_SIZE = 1000;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

function fromRow(row: Row): StoredSubscription {
  return {
    endpoint: row.endpoint,
    keys: { p256dh: row.p256dh, auth: row.auth },
    lat: row.lat,
    lon: row.lon,
    walkMinutes: row.walk_minutes,
    settings:
      parseAlertSettings({
        minLabel: row.min_label,
        leadMinutes: row.lead_minutes,
        happeningNow: row.happening_now,
        upgrades: row.upgrades,
      }) ?? DEFAULT_ALERT_SETTINGS,
    favorites: cleanFavorites(row.favorites),
    timezone: row.timezone,
    state: {
      decidedOn: row.decided_on,
      decidedScore: row.decided_score,
      sentOn: row.sent_on,
      sentKind: row.sent_kind,
      nowCheckedOn: row.now_checked_on,
      nowSentOn: row.now_sent_on,
    },
    lastOkAt: row.last_ok_at,
    lastTestAt: row.last_test_at,
  };
}

function stateColumns(record: Partial<AlertState>): Partial<Row> {
  const columns: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    columns[STATE_COLUMNS[key as keyof AlertState]] = value;
  }
  return columns as Partial<Row>;
}

function check<T>(result: { data: T; error: { message: string } | null }, what: string): T {
  if (result.error) throw new Error(`Supabase ${what} failed: ${result.error.message}`);
  return result.data;
}

/** Push subscriptions in Supabase Postgres, reached with the service role key (server only). */
export class SupabaseStore implements SubscriptionStore {
  constructor(private readonly db: SupabaseClient) {}

  async upsert(input: SubscriptionInput) {
    const row = {
      endpoint: input.endpoint,
      p256dh: input.keys.p256dh,
      auth: input.keys.auth,
      lat: input.lat,
      lon: input.lon,
      walk_minutes: input.walkMinutes,
      min_label: input.settings.minLabel,
      lead_minutes: input.settings.leadMinutes,
      happening_now: input.settings.happeningNow,
      upgrades: input.settings.upgrades,
      favorites: input.favorites,
      timezone: input.timezone,
      updated_at: new Date().toISOString(),
    };
    check(await this.db.from(TABLE).upsert(row, { onConflict: "endpoint" }), "upsert");
  }

  async remove(endpoint: string) {
    const data = check(await this.db.from(TABLE).delete().eq("endpoint", endpoint).select("endpoint"), "delete");
    return (data?.length ?? 0) > 0;
  }

  async get(endpoint: string) {
    const data = check(await this.db.from(TABLE).select(COLUMNS).eq("endpoint", endpoint).maybeSingle(), "select");
    return data ? fromRow(data as unknown as Row) : null;
  }

  async list() {
    const all: StoredSubscription[] = [];
    for (let from = 0; ; from += PAGE_SIZE) {
      const data = check(
        await this.db
          .from(TABLE)
          .select(COLUMNS)
          .order("created_at")
          .order("id")
          .range(from, from + PAGE_SIZE - 1),
        "list",
      );
      const rows = (data ?? []) as unknown as Row[];
      all.push(...rows.map(fromRow));
      if (rows.length < PAGE_SIZE) return all;
    }
  }

  async claim(endpoint: string, guard: AlertGuard, day: string, record: Partial<AlertState>) {
    if (!DAY.test(day)) throw new Error(`Not a date: ${day}`);
    const column = STATE_COLUMNS[guard];
    // One UPDATE … WHERE guard IS NULL OR guard <> day: Postgres lets only one of two racing runs match.
    const data = check(
      await this.db
        .from(TABLE)
        .update(stateColumns(record))
        .eq("endpoint", endpoint)
        .or(`${column}.is.null,${column}.neq.${day}`)
        .select("endpoint"),
      "claim",
    );
    return (data?.length ?? 0) > 0;
  }

  async markOk(endpoint: string, at: Date) {
    check(await this.db.from(TABLE).update({ last_ok_at: at.toISOString() }).eq("endpoint", endpoint), "update");
  }

  async claimTest(endpoint: string, now: Date, gapMs: number) {
    const stamp = { last_test_at: now.toISOString() };
    const first = check(
      await this.db.from(TABLE).update(stamp).eq("endpoint", endpoint).is("last_test_at", null).select("endpoint"),
      "update",
    );
    if ((first?.length ?? 0) > 0) return true;
    const cutoff = new Date(now.getTime() - gapMs).toISOString();
    const later = check(
      await this.db.from(TABLE).update(stamp).eq("endpoint", endpoint).lt("last_test_at", cutoff).select("endpoint"),
      "update",
    );
    return (later?.length ?? 0) > 0;
  }
}

export function supabaseStore(url: string, serviceRoleKey: string): SubscriptionStore {
  const db = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return new SupabaseStore(db);
}
