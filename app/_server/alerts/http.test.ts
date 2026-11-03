import { createECDH, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { EMPTY_ALERT_STATE, type PushMessage } from "@/lib/alerts";
import {
  hasBearer,
  isPushEndpoint,
  parseSubscribeBody,
  sendTest,
  subscribe,
  unsubscribe,
  type AlertServices,
} from "./http";
import type { PushSender, PushTarget, SendOptions, SendResult } from "./push";
import { MemoryStore } from "./store";

const ENDPOINT = "https://fcm.googleapis.com/fcm/send/abc123:APA91b-test";

/** Keys shaped like a browser's: a P-256 public key and a 16-byte auth secret. */
function browserKeys() {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return { p256dh: ecdh.getPublicKey().toString("base64url"), auth: randomBytes(16).toString("base64url") };
}

function body(overrides: Record<string, unknown> = {}) {
  return {
    subscription: { endpoint: ENDPOINT, expirationTime: null, keys: browserKeys() },
    settings: { minLabel: "Great", leadMinutes: 120, happeningNow: true, upgrades: true },
    place: { lat: 51.46123, lon: -0.03456, walkMinutes: 15 },
    timezone: "Europe/London",
    favorites: [{ id: "09404023", tile: "1029_-1", name: "Hilly Fields, by Adelaide Avenue" }],
    ...overrides,
  };
}

class FakeSender implements PushSender {
  sent: { target: PushTarget; message: PushMessage; options: SendOptions }[] = [];
  answer: SendResult = { ok: true, status: 201 };
  async send(target: PushTarget, message: PushMessage, options: SendOptions) {
    this.sent.push({ target, message, options });
    return this.answer;
  }
}

function setup(now = new Date("2026-11-03T12:00:00Z")) {
  const store = new MemoryStore();
  const sender = new FakeSender();
  const clock = { now };
  const services: AlertServices = {
    store,
    sender,
    cronSecret: "a-long-enough-cron-secret",
    forecastAt: async () => {
      throw new Error("not used");
    },
    spotsNear: async () => {
      throw new Error("not used");
    },
    clock: () => clock.now,
  };
  return { store, sender, services, clock };
}

const post = (path: string, payload: unknown, contentType = "application/json") =>
  new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": contentType },
    body: typeof payload === "string" ? payload : JSON.stringify(payload),
  });

describe("push endpoints", () => {
  it("must be https on a known push service", () => {
    for (const ok of [
      ENDPOINT,
      "https://fcm.googleapis.com/wp/dGVzdA",
      "https://web.push.apple.com/QGx2ZXJ5LWxvbmctdG9rZW4",
      "https://updates.push.services.mozilla.com/wpush/v2/gAAAAAB",
      "https://wns2-par02p.notify.windows.com/w/?token=BQYAAAB",
    ]) {
      expect(isPushEndpoint(ok), ok).toBe(true);
    }
    for (const bad of [
      "http://fcm.googleapis.com/fcm/send/abc",
      "https://fcm.googleapis.com.evil.example/fcm/send/abc",
      "https://evil-fcm.googleapis.com/fcm/send/abc",
      "https://example.com/push",
      "https://push.services.mozilla.com.attacker.io/x",
      "https://fcm.googleapis.com:8443/fcm/send/abc",
      "https://user:pass@fcm.googleapis.com/fcm/send/abc",
      "https://fcm.googleapis.com/",
      "https://localhost/fcm/send/abc",
      `https://fcm.googleapis.com/${"a".repeat(3000)}`,
      "not a url",
      42,
      null,
    ]) {
      expect(isPushEndpoint(bad), String(bad)).toBe(false);
    }
  });
});

describe("subscribe requests", () => {
  it("are checked and the place rounded to 0.01°", () => {
    const parsed = parseSubscribeBody(body());
    expect(parsed).toMatchObject({
      value: {
        endpoint: ENDPOINT,
        lat: 51.46,
        lon: -0.03,
        walkMinutes: 15,
        timezone: "Europe/London",
        settings: { minLabel: "Great", leadMinutes: 120 },
        favorites: [{ id: "09404023" }],
      },
    });
    expect(parseSubscribeBody(body({ favorites: undefined }))).toMatchObject({ value: { favorites: [] } });
  });

  it("refuse anything malformed", () => {
    const keys = browserKeys();
    const cases: Record<string, unknown>[] = [
      { subscription: { endpoint: "https://example.com/x", keys } },
      { subscription: { endpoint: ENDPOINT } },
      { subscription: { endpoint: ENDPOINT, keys: { ...keys, p256dh: "short" } } },
      { subscription: { endpoint: ENDPOINT, keys: { ...keys, auth: randomBytes(8).toString("base64url") } } },
      { subscription: { endpoint: ENDPOINT, keys: { ...keys, p256dh: randomBytes(65).toString("base64url").replace(/^./, "A") } } },
      { settings: { minLabel: "Fair", leadMinutes: 120, happeningNow: true, upgrades: true } },
      { settings: { minLabel: "Great", leadMinutes: 45, happeningNow: true, upgrades: true } },
      { settings: undefined },
      { place: { lat: 95, lon: 0, walkMinutes: 15 } },
      { place: { lat: "51.5", lon: 0, walkMinutes: 15 } },
      { place: { lat: 51.5, lon: 0, walkMinutes: 15.5 } },
      { place: { lat: 51.5, lon: 0, walkMinutes: 600 } },
      { place: { lat: Number.NaN, lon: 0, walkMinutes: 15 } },
      { timezone: "Not/AZone" },
      { timezone: undefined },
      { favorites: [{ id: "x", tile: "../../etc/passwd", name: "x" }] },
      { favorites: "nope" },
    ];
    for (const overrides of cases) {
      expect(parseSubscribeBody(body(overrides)), JSON.stringify(overrides)).toHaveProperty("error");
    }
    expect(parseSubscribeBody([])).toHaveProperty("error");
    expect(parseSubscribeBody(null)).toHaveProperty("error");
  });
});

describe("POST /api/push/subscribe", () => {
  it("stores the subscription, and updates settings without resetting today's decisions", async () => {
    const { store, services } = setup();
    const response = await subscribe(post("/api/push/subscribe", body()), services);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, place: { lat: 51.46, lon: -0.03 } });
    expect(store.rows.get(ENDPOINT)).toMatchObject({ lat: 51.46, lon: -0.03, state: EMPTY_ALERT_STATE });

    await store.claim(ENDPOINT, "decidedOn", "2026-11-03", { decidedOn: "2026-11-03", decidedScore: 50 });
    const changed = body({ settings: { minLabel: "Good", leadMinutes: 60, happeningNow: false, upgrades: false } });
    expect((await subscribe(post("/api/push/subscribe", changed), services)).status).toBe(200);
    expect(store.rows.size).toBe(1);
    expect(store.rows.get(ENDPOINT)).toMatchObject({
      settings: { minLabel: "Good", leadMinutes: 60, happeningNow: false, upgrades: false },
      state: { decidedOn: "2026-11-03", decidedScore: 50 },
    });
  });

  it("answers 400 for a bad request, 415 for non-JSON and 413 for a huge one", async () => {
    const { store, services } = setup();
    const bad = await subscribe(post("/api/push/subscribe", body({ timezone: "Nowhere" })), services);
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: "timezone must be an IANA time zone, e.g. Europe/London" });
    expect((await subscribe(post("/api/push/subscribe", "{oops"), services)).status).toBe(400);
    expect((await subscribe(post("/api/push/subscribe", JSON.stringify(body()), "text/plain"), services)).status).toBe(415);
    const huge = body({ favorites: [{ id: "a", tile: "1_1", name: "x".repeat(20_000) }] });
    expect((await subscribe(post("/api/push/subscribe", huge), services)).status).toBe(413);
    expect(store.rows.size).toBe(0);
  });

  it("answers 503 while alerts aren't set up", async () => {
    const response = await subscribe(post("/api/push/subscribe", body()), null);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Alerts aren't set up yet" });
  });

  it("answers 502 when the database fails", async () => {
    const { store, services } = setup();
    store.upsert = async () => {
      throw new Error("Supabase upsert failed: timeout");
    };
    const response = await subscribe(post("/api/push/subscribe", body()), services);
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "Something went wrong. Try again in a minute." });
  });
});

describe("POST /api/push/unsubscribe", () => {
  it("removes the subscription", async () => {
    const { store, services } = setup();
    await subscribe(post("/api/push/subscribe", body()), services);
    const response = await unsubscribe(post("/api/push/unsubscribe", { endpoint: ENDPOINT }), services);
    expect(await response.json()).toEqual({ ok: true, removed: true });
    expect(store.rows.size).toBe(0);
    const again = await unsubscribe(post("/api/push/unsubscribe", { endpoint: ENDPOINT }), services);
    expect(await again.json()).toEqual({ ok: true, removed: false });
    expect((await unsubscribe(post("/api/push/unsubscribe", { endpoint: "https://example.com/x" }), services)).status).toBe(
      400,
    );
    expect((await unsubscribe(post("/api/push/unsubscribe", { endpoint: ENDPOINT }), null)).status).toBe(503);
  });
});

describe("POST /api/push/test", () => {
  it("sends a test to a stored subscription, at most once a minute", async () => {
    const { sender, services, clock } = setup();
    await subscribe(post("/api/push/subscribe", body()), services);
    const test = () => sendTest(post("/api/push/test", { endpoint: ENDPOINT }), services);

    const first = await test();
    expect(first.status).toBe(200);
    expect(sender.sent).toHaveLength(1);
    expect(sender.sent[0].target.endpoint).toBe(ENDPOINT);
    expect(sender.sent[0].message).toEqual({
      title: "Test alert from Afterglow",
      body: "Alerts are on. You'll hear from us when tonight's sunset looks Great or better.",
      url: "/alerts",
      tag: "afterglow-test",
    });

    clock.now = new Date(clock.now.getTime() + 30_000);
    const tooSoon = await test();
    expect(tooSoon.status).toBe(429);
    expect(tooSoon.headers.get("retry-after")).toBe("60");
    expect(sender.sent).toHaveLength(1);

    clock.now = new Date(clock.now.getTime() + 31_000);
    expect((await test()).status).toBe(200);
    expect(sender.sent).toHaveLength(2);
  });

  it("answers 404 for an unknown device, and removes one the push service has dropped", async () => {
    const { store, sender, services } = setup();
    expect((await sendTest(post("/api/push/test", { endpoint: ENDPOINT }), services)).status).toBe(404);
    await subscribe(post("/api/push/subscribe", body()), services);
    sender.answer = { ok: false, gone: true, status: 410, error: "Gone (410)" };
    expect((await sendTest(post("/api/push/test", { endpoint: ENDPOINT }), services)).status).toBe(410);
    expect(store.rows.size).toBe(0);
  });

  it("answers 502 when the push service fails", async () => {
    const { sender, services } = setup();
    await subscribe(post("/api/push/subscribe", body()), services);
    sender.answer = { ok: false, gone: false, status: 503, error: "Service Unavailable (503)" };
    expect((await sendTest(post("/api/push/test", { endpoint: ENDPOINT }), services)).status).toBe(502);
  });
});

describe("the cron secret", () => {
  it("must match exactly", () => {
    expect(hasBearer("Bearer s3cret-s3cret-s3cret", "s3cret-s3cret-s3cret")).toBe(true);
    expect(hasBearer("bearer s3cret-s3cret-s3cret", "s3cret-s3cret-s3cret")).toBe(true);
    expect(hasBearer("Bearer s3cret", "s3cret-s3cret-s3cret")).toBe(false);
    expect(hasBearer("s3cret-s3cret-s3cret", "s3cret-s3cret-s3cret")).toBe(false);
    expect(hasBearer(null, "s3cret-s3cret-s3cret")).toBe(false);
    expect(hasBearer("Bearer ", "")).toBe(false);
  });
});
