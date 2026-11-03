import {
  DEFAULT_ALERT_SETTINGS,
  cleanFavorites,
  parseAlertSettings,
  type AlertSettings,
  type Favorite,
} from "@/lib/alerts";
import { roundTo } from "@/lib/geo";

/** Browser-side helpers for sunset alerts: settings in localStorage, the push subscription, the API. */

const SETTINGS_KEY = "afterglow:alerts";
const SYNCED_KEY = "afterglow:alerts:synced";
const FAVORITES_KEY = "afterglow:favorites";
const PLACE_KEY = "afterglow:place";
const WALK_KEY = "afterglow:walk";
const SYNC_EVERY_MS = 24 * 60 * 60 * 1000;

function readJson(key: string): unknown {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null");
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private mode or storage blocked: it just forgets.
  }
}

export const readAlertSettings = (): AlertSettings => parseAlertSettings(readJson(SETTINGS_KEY)) ?? DEFAULT_ALERT_SETTINGS;
export const saveAlertSettings = (settings: AlertSettings) => writeJson(SETTINGS_KEY, settings);
/** Favorites saved in the app (`afterglow:favorites`), keeping only well-formed entries. */
export const readFavorites = (): Favorite[] => cleanFavorites(readJson(FAVORITES_KEY));

const isIos = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

const isInstalled = () =>
  window.matchMedia("(display-mode: standalone)").matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;

export type PushSupport = "supported" | "ios-install" | "ios-update" | "unsupported";

/** Whether this browser can get alerts; iPhone only can from the home screen app (iOS 16.4 and later). */
export function pushSupport(): PushSupport {
  if ("serviceWorker" in navigator && "PushManager" in window && "Notification" in window) return "supported";
  if (isIos()) return isInstalled() ? "ios-update" : "ios-install";
  return "unsupported";
}

/** The base64url VAPID public key as the bytes pushManager.subscribe() wants. */
export function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/** Whether a subscription was made with this VAPID key (it changes if the server's keys are replaced). */
export function madeWithKey(subscription: PushSubscription, publicKey: string): boolean {
  const key = subscription.options.applicationServerKey;
  if (!key) return true;
  const a = new Uint8Array(key);
  const b = keyBytes(publicKey);
  return a.length === b.length && a.every((byte, i) => byte === b[i]);
}

const timeout = (ms: number) => new Promise<null>((resolve) => setTimeout(() => resolve(null), ms));

/**
 * The service worker that shows alerts (public/sw.js). The app registers it in production
 * builds; this waits for it, registering it first if needed. Null where it doesn't run (development).
 */
export async function alertWorker(): Promise<ServiceWorkerRegistration | null> {
  let registration = await navigator.serviceWorker.getRegistration("/");
  if (!registration && process.env.NODE_ENV === "production") {
    registration = await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
  }
  if (!registration) return null;
  return Promise.race([navigator.serviceWorker.ready, timeout(10_000)]);
}

/** This device's current push subscription, if alerts are on. */
export async function currentSubscription(): Promise<PushSubscription | null> {
  const registration = await navigator.serviceWorker.getRegistration("/");
  return (await registration?.pushManager.getSubscription()) ?? null;
}

export interface AlertPlace {
  lat: number;
  lon: number;
  walkMinutes: number;
}

/** What the server keeps for this device. The place is rounded to 0.01° (about 1 km) before it leaves the phone. */
export function subscriptionBody(
  subscription: PushSubscription,
  settings: AlertSettings,
  place: AlertPlace,
  favorites: Favorite[],
) {
  return {
    subscription: subscription.toJSON(),
    settings,
    place: { lat: roundTo(place.lat, 0.01), lon: roundTo(place.lon, 0.01), walkMinutes: place.walkMinutes },
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/London",
    favorites,
  };
}

export type ApiResult = { ok: true; status: number } | { ok: false; status: number | null; error: string };

export async function postJson(path: string, body: unknown): Promise<ApiResult> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, status: null, error: "Couldn't reach Afterglow. Check your connection and try again." };
  }
  if (response.ok) return { ok: true, status: response.status };
  const message: unknown = await response
    .json()
    .then((data: { error?: unknown }) => data.error)
    .catch(() => null);
  return { ok: false, status: response.status, error: typeof message === "string" ? message : `Error ${response.status}` };
}

/** Saves this device's subscription and settings on the server, and remembers what was sent. */
export async function saveSubscription(body: ReturnType<typeof subscriptionBody>): Promise<ApiResult> {
  const result = await postJson("/api/push/subscribe", body);
  if (result.ok) writeJson(SYNCED_KEY, { body: syncKey(body), at: Date.now() });
  return result;
}

export function forgetSync() {
  try {
    localStorage.removeItem(SYNCED_KEY);
  } catch {
    // Storage blocked: nothing to forget.
  }
}

/** What identifies a saved state: everything sent except the subscription's keys. */
export const syncKey = (body: ReturnType<typeof subscriptionBody>) =>
  JSON.stringify({ ...body, subscription: body.subscription.endpoint });

/**
 * Keeps the server's copy of this device's place, walk, settings and favorites up to date, e.g.
 * when the app opens after the place changed. Does nothing unless alerts are on here, and only
 * posts when something changed or a day has passed.
 */
export async function syncAlertsQuietly(): Promise<void> {
  if (pushSupport() !== "supported") return;
  const subscription = await currentSubscription().catch(() => null);
  const place = readJson(PLACE_KEY) as { lat?: unknown; lon?: unknown } | null;
  if (!subscription || typeof place?.lat !== "number" || typeof place.lon !== "number") return;
  const walk = readJson(WALK_KEY);
  const body = subscriptionBody(
    subscription,
    readAlertSettings(),
    { lat: place.lat, lon: place.lon, walkMinutes: typeof walk === "number" ? walk : 15 },
    readFavorites(),
  );
  const last = readJson(SYNCED_KEY) as { body?: string; at?: number } | null;
  if (last?.body === syncKey(body) && Date.now() - (last.at ?? 0) < SYNC_EVERY_MS) return;
  await saveSubscription(body);
}
