import { createHash, timingSafeEqual } from "node:crypto";
import { isTimeZone, parseAlertSettings, parseFavorites, testMessage } from "@/lib/alerts";
import { roundTo } from "@/lib/geo";
import { runAlertJob, type JobDeps } from "./job";
import type { PushSender } from "./push";
import type { SubscriptionInput, SubscriptionStore } from "./store";

/**
 * The alert API as plain functions of a Request, so tests can call them with an in-memory store
 * and a fake push sender. The route files in app/api wire them to Supabase and web-push.
 */
export interface AlertServices {
  store: SubscriptionStore;
  sender: PushSender;
  cronSecret: string;
  forecastAt: JobDeps["forecastAt"];
  spotsNear: JobDeps["spotsNear"];
  /** The current time; tests pin it. */
  clock?: () => Date;
}

export const NOT_SET_UP = "Alerts aren't set up yet";
export const TEST_GAP_MS = 60_000;
const MAX_BODY_BYTES = 16_384;
const MAX_ENDPOINT_LENGTH = 2048;

/** Push services that browsers use. Anything else is refused, so the server only ever posts to these. */
const PUSH_HOSTS = ["fcm.googleapis.com", "web.push.apple.com"];
const PUSH_HOST_SUFFIXES = [".push.services.mozilla.com", ".notify.windows.com"];

export function isPushEndpoint(value: unknown): value is string {
  if (typeof value !== "string" || value.length > MAX_ENDPOINT_LENGTH) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return false;
  if (url.pathname.length < 2) return false;
  const host = url.hostname;
  return PUSH_HOSTS.includes(host) || PUSH_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A base64url key of exactly `bytes` bytes, as browsers give them. */
function isKey(value: unknown, bytes: number): value is string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+={0,2}$/.test(value)) return false;
  const decoded = Buffer.from(value, "base64url");
  return decoded.length === bytes && (bytes !== 65 || decoded[0] === 0x04);
}

const isNumberIn = (value: unknown, min: number, max: number): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;

/** Checks everything in a subscribe request. Lat and lon come back rounded to 0.01° (about 1 km). */
export function parseSubscribeBody(body: unknown): { value: SubscriptionInput } | { error: string } {
  if (!isRecord(body)) return { error: "Expected a JSON object" };
  const { subscription, settings, place, timezone, favorites } = body;
  if (!isRecord(subscription) || !isPushEndpoint(subscription.endpoint)) {
    return { error: "subscription.endpoint must be an https URL on a known push service" };
  }
  const keys = subscription.keys;
  if (!isRecord(keys) || !isKey(keys.p256dh, 65) || !isKey(keys.auth, 16)) {
    return { error: "subscription.keys must hold p256dh and auth" };
  }
  const parsedSettings = parseAlertSettings(settings);
  if (!parsedSettings) {
    return { error: "settings must be { minLabel: Good|Great|Epic, leadMinutes: 60|120|180, happeningNow, upgrades }" };
  }
  if (!isRecord(place) || !isNumberIn(place.lat, -90, 90) || !isNumberIn(place.lon, -180, 180)) {
    return { error: "place must be { lat, lon, walkMinutes }" };
  }
  if (!Number.isInteger(place.walkMinutes) || !isNumberIn(place.walkMinutes, 1, 60)) {
    return { error: "place.walkMinutes must be a whole number of minutes, 1 to 60" };
  }
  if (!isTimeZone(timezone)) return { error: "timezone must be an IANA time zone, e.g. Europe/London" };
  const parsedFavorites = favorites === undefined ? [] : parseFavorites(favorites);
  if (!parsedFavorites) return { error: "favorites must be a list of { id, tile, name }" };

  return {
    value: {
      endpoint: subscription.endpoint,
      keys: { p256dh: keys.p256dh, auth: keys.auth },
      lat: roundTo(place.lat, 0.01),
      lon: roundTo(place.lon, 0.01),
      walkMinutes: place.walkMinutes,
      settings: parsedSettings,
      favorites: parsedFavorites,
      timezone,
    },
  };
}

const reply = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });

/** The JSON body of a request from the app, or the error response to send instead. */
async function readJson(request: Request): Promise<{ body: unknown } | { response: Response }> {
  // Requiring JSON also means other sites can't post here from a plain form.
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return { response: reply({ error: "Send JSON (Content-Type: application/json)" }, 415) };
  }
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
    return { response: reply({ error: "Request too large" }, 413) };
  }
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return { response: reply({ error: "Request too large" }, 413) };
  try {
    return { body: JSON.parse(text) };
  } catch {
    return { response: reply({ error: "Expected JSON" }, 400) };
  }
}

async function readEndpoint(request: Request): Promise<{ endpoint: string } | { response: Response }> {
  const read = await readJson(request);
  if ("response" in read) return read;
  const endpoint = isRecord(read.body) ? read.body.endpoint : undefined;
  if (!isPushEndpoint(endpoint)) return { response: reply({ error: "endpoint must be a push subscription URL" }, 400) };
  return { endpoint };
}

/** Runs a handler, turning unexpected errors (say, the database is down) into a 502. */
async function guarded(name: string, run: () => Promise<Response>): Promise<Response> {
  try {
    return await run();
  } catch (error) {
    console.error(`Alerts ${name} failed:`, error);
    return reply({ error: "Something went wrong. Try again in a minute." }, 502);
  }
}

/** POST /api/push/subscribe { subscription, settings, place, timezone, favorites } */
export async function subscribe(request: Request, services: AlertServices | null): Promise<Response> {
  if (!services) return reply({ error: NOT_SET_UP }, 503);
  return guarded("subscribe", async () => {
    const read = await readJson(request);
    if ("response" in read) return read.response;
    const parsed = parseSubscribeBody(read.body);
    if ("error" in parsed) return reply({ error: parsed.error }, 400);
    await services.store.upsert(parsed.value);
    return reply({ ok: true, place: { lat: parsed.value.lat, lon: parsed.value.lon } });
  });
}

/** POST /api/push/unsubscribe { endpoint } */
export async function unsubscribe(request: Request, services: AlertServices | null): Promise<Response> {
  if (!services) return reply({ error: NOT_SET_UP }, 503);
  return guarded("unsubscribe", async () => {
    const read = await readEndpoint(request);
    if ("response" in read) return read.response;
    return reply({ ok: true, removed: await services.store.remove(read.endpoint) });
  });
}

/** POST /api/push/test { endpoint }: a test notification to a stored subscription, at most one a minute. */
export async function sendTest(request: Request, services: AlertServices | null): Promise<Response> {
  if (!services) return reply({ error: NOT_SET_UP }, 503);
  return guarded("test", async () => {
    const read = await readEndpoint(request);
    if ("response" in read) return read.response;
    const sub = await services.store.get(read.endpoint);
    if (!sub) return reply({ error: "Alerts aren't on for this device" }, 404);
    const now = services.clock?.() ?? new Date();
    if (!(await services.store.claimTest(sub.endpoint, now, TEST_GAP_MS))) {
      return reply({ error: "One test a minute. Try again shortly." }, 429, { "Retry-After": "60" });
    }
    const result = await services.sender.send(sub, testMessage(sub.settings.minLabel), { ttlSeconds: 300 });
    if (result.ok) {
      await services.store.markOk(sub.endpoint, now);
      return reply({ ok: true });
    }
    if (result.gone) {
      await services.store.remove(sub.endpoint);
      return reply({ error: "This device's alerts have expired. Switch alerts off and on again." }, 410);
    }
    console.error("Alerts test send failed:", result.error);
    return reply({ error: "The push service didn't take the test. Try again in a minute." }, 502);
  });
}

/** Constant-time check of "Authorization: Bearer <secret>". */
export function hasBearer(header: string | null, secret: string): boolean {
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header ?? "");
  if (!match || !secret) return false;
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(match[1]), digest(secret));
}

/** POST /api/cron/alerts, called by Supabase Cron every 15 minutes with the cron secret. */
export async function runCron(request: Request, services: AlertServices | null): Promise<Response> {
  if (!services) return reply({ error: NOT_SET_UP }, 503);
  if (!hasBearer(request.headers.get("authorization"), services.cronSecret)) {
    return reply({ error: "Unauthorized" }, 401);
  }
  try {
    const summary = await runAlertJob({
      store: services.store,
      sender: services.sender,
      forecastAt: services.forecastAt,
      spotsNear: services.spotsNear,
      now: services.clock?.(),
    });
    if (summary.errors.length) console.warn("Alert job problems:", summary.errors);
    return reply({ ok: true, ...summary });
  } catch (error) {
    console.error("Alert job failed:", error);
    return reply({ ok: false, error: error instanceof Error ? error.message : String(error) }, 500);
  }
}
