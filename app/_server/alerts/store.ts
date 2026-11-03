import {
  EMPTY_ALERT_STATE,
  type AlertGuard,
  type AlertSettings,
  type AlertState,
  type Favorite,
} from "@/lib/alerts";

/** A browser's push subscription keys (PushSubscription.toJSON().keys). */
export interface PushKeys {
  p256dh: string;
  auth: string;
}

/** What a subscriber sends when switching alerts on or changing settings. */
export interface SubscriptionInput {
  endpoint: string;
  keys: PushKeys;
  /** Rounded to 0.01° (about 1 km) before it's stored. */
  lat: number;
  lon: number;
  walkMinutes: number;
  settings: AlertSettings;
  favorites: Favorite[];
  timezone: string;
}

export interface StoredSubscription extends SubscriptionInput {
  state: AlertState;
  lastOkAt: string | null;
  lastTestAt: string | null;
}

/** Where push subscriptions live: Supabase in production, memory in tests. */
export interface SubscriptionStore {
  /** Adds a subscription, or updates its settings (never its alert state) if the endpoint is known. */
  upsert(input: SubscriptionInput): Promise<void>;
  /** True when there was something to remove. */
  remove(endpoint: string): Promise<boolean>;
  get(endpoint: string): Promise<StoredSubscription | null>;
  list(): Promise<StoredSubscription[]>;
  /**
   * Saves `record` only while `guard` isn't `day` yet, in one atomic step. True when this call
   * saved it; false when another run got there first (or the subscription is gone).
   */
  claim(endpoint: string, guard: AlertGuard, day: string, record: Partial<AlertState>): Promise<boolean>;
  /** Notes that a push service accepted a message. */
  markOk(endpoint: string, at: Date): Promise<void>;
  /** Notes a test alert unless there was one less than `gapMs` ago; true when this one may go. */
  claimTest(endpoint: string, now: Date, gapMs: number): Promise<boolean>;
}

/** An in-memory store for tests and local runs. Each method is a single synchronous step, so claims are atomic. */
export class MemoryStore implements SubscriptionStore {
  readonly rows = new Map<string, StoredSubscription>();

  constructor(initial: StoredSubscription[] = []) {
    for (const row of initial) this.rows.set(row.endpoint, structuredClone(row));
  }

  async upsert(input: SubscriptionInput) {
    const existing = this.rows.get(input.endpoint);
    this.rows.set(input.endpoint, {
      state: { ...EMPTY_ALERT_STATE },
      lastOkAt: null,
      lastTestAt: null,
      ...existing,
      ...structuredClone(input),
    });
  }

  async remove(endpoint: string) {
    return this.rows.delete(endpoint);
  }

  async get(endpoint: string) {
    const row = this.rows.get(endpoint);
    return row ? structuredClone(row) : null;
  }

  async list() {
    return [...this.rows.values()].map((row) => structuredClone(row));
  }

  async claim(endpoint: string, guard: AlertGuard, day: string, record: Partial<AlertState>) {
    const row = this.rows.get(endpoint);
    if (!row || row.state[guard] === day) return false;
    row.state = { ...row.state, ...record };
    return true;
  }

  async markOk(endpoint: string, at: Date) {
    const row = this.rows.get(endpoint);
    if (row) row.lastOkAt = at.toISOString();
  }

  async claimTest(endpoint: string, now: Date, gapMs: number) {
    const row = this.rows.get(endpoint);
    if (!row) return false;
    if (row.lastTestAt && now.getTime() - Date.parse(row.lastTestAt) < gapMs) return false;
    row.lastTestAt = now.toISOString();
    return true;
  }
}
