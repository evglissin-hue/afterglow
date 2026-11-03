import webpush from "web-push";
import type { PushMessage } from "@/lib/alerts";
import type { PushKeys } from "./store";

export interface PushTarget {
  endpoint: string;
  keys: PushKeys;
}

export interface SendOptions {
  /** How long the push service keeps trying a phone that's offline, in seconds. */
  ttlSeconds: number;
  /** "high" asks Android to deliver at once, even in battery saving. */
  urgency?: "normal" | "high";
}

export type SendResult =
  | { ok: true; status: number }
  /** `gone`: the push service says this subscription no longer exists (404/410), so delete it. */
  | { ok: false; gone: boolean; status: number | null; error: string };

/** Sends one notification. The web-push package in production, a fake in tests. */
export interface PushSender {
  send(target: PushTarget, message: PushMessage, options: SendOptions): Promise<SendResult>;
}

export interface VapidDetails {
  /** A contact for the push services: the site's URL. */
  subject: string;
  publicKey: string;
  privateKey: string;
}

type SendNotification = typeof webpush.sendNotification;

const RETRY_DELAY_MS = 1000;
const TIMEOUT_MS = 10_000;

function failure(error: unknown): Extract<SendResult, { ok: false }> {
  const status =
    error instanceof webpush.WebPushError || (typeof error === "object" && error !== null && "statusCode" in error)
      ? Number((error as { statusCode: unknown }).statusCode) || null
      : null;
  const message = error instanceof Error ? error.message : String(error);
  return { ok: false, gone: status === 404 || status === 410, status, error: status ? `${message} (${status})` : message };
}

/** Worth one more try: the network failed, or the push service is busy or briefly down. */
const retryable = (result: Extract<SendResult, { ok: false }>) =>
  result.status === null || result.status === 429 || result.status >= 500;

/** Sends with the web-push package (VAPID, aes128gcm), retrying once after a network error or a busy push service. */
export function webPushSender(
  vapid: VapidDetails,
  { send = webpush.sendNotification, wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)) }: {
    send?: SendNotification;
    wait?: (ms: number) => Promise<void>;
  } = {},
): PushSender {
  return {
    async send(target, message, { ttlSeconds, urgency = "high" }) {
      const payload = JSON.stringify(message);
      const options = { vapidDetails: vapid, TTL: Math.max(0, Math.round(ttlSeconds)), urgency, timeout: TIMEOUT_MS };
      let result = failure(new Error("not sent"));
      for (let attempt = 0; attempt < 2; attempt++) {
        if (attempt > 0) await wait(RETRY_DELAY_MS);
        try {
          const response = await send({ endpoint: target.endpoint, keys: target.keys }, payload, options);
          return { ok: true, status: response.statusCode };
        } catch (error) {
          result = failure(error);
          if (!retryable(result)) break;
        }
      }
      return result;
    },
  };
}
