import { isVapidKey, type AlertSecrets } from "./secrets";

/**
 * Where alerts find their database, from environment variables. Vercel's Supabase integration (Vercel
 * → Storage → Supabase) adds these by itself; either name of each works. Without them, alerts are
 * "not set up yet": the API answers 503 and the settings page says alerts aren't switched on.
 */
export interface SupabaseEnv {
  url: string;
  serviceKey: string;
}

const SITE_URL = "https://afterglow-evglissin-hue.vercel.app";

export function readSupabaseEnv(): SupabaseEnv | null {
  const url = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || "").trim();
  if (!url || !serviceKey) return null;
  if (!/^https?:\/\//.test(url)) {
    console.error("Alerts are off: SUPABASE_URL should look like https://xyz.supabase.co.");
    return null;
  }
  return { url, serviceKey };
}

/**
 * Secrets set by hand as environment variables, if any (optional: the server makes and keeps its own
 * in the database). Malformed ones are ignored.
 */
export function secretOverrides(): Partial<AlertSecrets> {
  const overrides: Partial<AlertSecrets> = {};
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  if (isVapidKey(publicKey, 65) && isVapidKey(privateKey, 32)) {
    overrides.vapidPublicKey = publicKey;
    overrides.vapidPrivateKey = privateKey;
  }
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (cronSecret && cronSecret.length >= 16) overrides.cronSecret = cronSecret;
  return overrides;
}

/** A contact for push services: the site's address. */
export function vapidSubject(): string {
  const configured = process.env.VAPID_SUBJECT?.trim();
  if (configured && /^(https:\/\/|mailto:)/.test(configured)) return configured;
  const production = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  return production ? `https://${production}` : SITE_URL;
}
