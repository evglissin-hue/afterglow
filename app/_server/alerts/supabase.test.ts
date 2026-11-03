import { describe, expect, it } from "vitest";
import { DEFAULT_ALERT_SETTINGS, EMPTY_ALERT_STATE } from "@/lib/alerts";
import { supabaseStore } from "./supabase";

// The requests the store sends to Supabase's REST API (PostgREST), checked without a database.
// supabase/schema.sql was run against Postgres separately to check the SQL these filters become.

const ENDPOINT = "https://fcm.googleapis.com/fcm/send/abc:APA91b";

interface Seen {
  method: string;
  path: string;
  params: Record<string, string>;
  prefer: string | null;
  body: unknown;
}

function fakeSupabase(answers: unknown[] = []) {
  const seen: Seen[] = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    seen.push({
      method: init?.method ?? "GET",
      path: url.pathname,
      params: Object.fromEntries(url.searchParams),
      prefer: headers.get("prefer"),
      body: init?.body ? JSON.parse(String(init.body)) : null,
    });
    expect(headers.get("apikey")).toBe("service-role-key");
    const answer = answers.length ? answers.shift() : [];
    return new Response(JSON.stringify(answer), {
      status: 200,
      headers: { "content-type": "application/json", "content-range": "0-0/*" },
    });
  }) as typeof globalThis.fetch;
  return { seen, store: supabaseStore("https://project.supabase.co", "service-role-key", fetch) };
}

const row = {
  endpoint: ENDPOINT,
  p256dh: "BKey",
  auth: "authKey",
  lat: 51.46,
  lon: -0.03,
  walk_minutes: 15,
  min_label: "Epic",
  lead_minutes: 60,
  happening_now: false,
  upgrades: true,
  favorites: [{ id: "09404023", tile: "1029_-1", name: "Hilly Fields" }, { bad: true }],
  timezone: "Europe/London",
  last_ok_at: null,
  last_test_at: null,
  decided_on: "2026-11-03",
  decided_score: 50,
  sent_on: null,
  sent_kind: null,
  now_checked_on: null,
  now_sent_on: null,
};

describe("the Supabase store", () => {
  it("upserts by endpoint without touching the alert state", async () => {
    const { seen, store } = fakeSupabase();
    await store.upsert({
      endpoint: ENDPOINT,
      keys: { p256dh: "BKey", auth: "authKey" },
      lat: 51.46,
      lon: -0.03,
      walkMinutes: 15,
      settings: DEFAULT_ALERT_SETTINGS,
      favorites: [],
      timezone: "Europe/London",
    });
    const [request] = seen;
    expect(request).toMatchObject({
      method: "POST",
      path: "/rest/v1/push_subscriptions",
      params: { on_conflict: "endpoint" },
    });
    expect(request.prefer).toContain("resolution=merge-duplicates");
    expect(Object.keys(request.body as object).sort()).toEqual(
      [
        "auth", "endpoint", "favorites", "happening_now", "lat", "lead_minutes", "lon", "min_label",
        "p256dh", "timezone", "updated_at", "upgrades", "walk_minutes",
      ].sort(),
    );
  });

  it("claims a decision with one guarded update", async () => {
    const { seen, store } = fakeSupabase([[{ endpoint: ENDPOINT }], []]);
    const record = { decidedOn: "2026-11-03", decidedScore: 74, sentOn: "2026-11-03", sentKind: "pre-sunset" as const };
    expect(await store.claim(ENDPOINT, "decidedOn", "2026-11-03", record)).toBe(true);
    expect(await store.claim(ENDPOINT, "decidedOn", "2026-11-03", record)).toBe(false);
    expect(seen[0]).toMatchObject({
      method: "PATCH",
      params: { endpoint: `eq.${ENDPOINT}`, or: "(decided_on.is.null,decided_on.neq.2026-11-03)", select: "endpoint" },
      body: { decided_on: "2026-11-03", decided_score: 74, sent_on: "2026-11-03", sent_kind: "pre-sunset" },
    });
    await expect(store.claim(ENDPOINT, "sentOn", "2026-11-03); drop table x;--", {})).rejects.toThrow(/Not a date/);
  });

  it("lists every subscription in pages, mapping columns and skipping bad favorites", async () => {
    const page = Array.from({ length: 1000 }, (_, i) => ({ ...row, endpoint: `${ENDPOINT}${i}` }));
    const { seen, store } = fakeSupabase([page, [row]]);
    const all = await store.list();
    expect(all).toHaveLength(1001);
    expect(seen.map((s) => [s.params.offset, s.params.limit])).toEqual([
      ["0", "1000"],
      ["1000", "1000"],
    ]);
    expect(seen[0].params.order).toBe("created_at.asc,id.asc");
    expect(all[1000]).toEqual({
      endpoint: ENDPOINT,
      keys: { p256dh: "BKey", auth: "authKey" },
      lat: 51.46,
      lon: -0.03,
      walkMinutes: 15,
      settings: { minLabel: "Epic", leadMinutes: 60, happeningNow: false, upgrades: true },
      favorites: [{ id: "09404023", tile: "1029_-1", name: "Hilly Fields" }],
      timezone: "Europe/London",
      state: { ...EMPTY_ALERT_STATE, decidedOn: "2026-11-03", decidedScore: 50 },
      lastOkAt: null,
      lastTestAt: null,
    });
  });

  it("rate-limits tests with two guarded updates", async () => {
    const { seen, store } = fakeSupabase([[], [{ endpoint: ENDPOINT }]]);
    const now = new Date("2026-11-03T12:00:00Z");
    expect(await store.claimTest(ENDPOINT, now, 60_000)).toBe(true);
    expect(seen[0].params).toMatchObject({ last_test_at: "is.null" });
    expect(seen[1].params).toMatchObject({ last_test_at: "lt.2026-11-03T11:59:00.000Z" });
    expect(seen[1].body).toEqual({ last_test_at: "2026-11-03T12:00:00.000Z" });
  });

  it("deletes by endpoint and reports database errors", async () => {
    const { seen, store } = fakeSupabase([[{ endpoint: ENDPOINT }]]);
    expect(await store.remove(ENDPOINT)).toBe(true);
    expect(seen[0]).toMatchObject({ method: "DELETE", params: { endpoint: `eq.${ENDPOINT}` } });

    const failing = supabaseStore("https://project.supabase.co", "service-role-key", (async () =>
      new Response(JSON.stringify({ message: 'relation "push_subscriptions" does not exist', code: "42P01" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      })) as typeof fetch);
    await expect(failing.list()).rejects.toThrow('Supabase list failed: relation "push_subscriptions" does not exist');
  });
});
