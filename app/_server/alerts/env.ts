/**
 * The settings alerts need, from environment variables (Vercel → Settings → Environment Variables).
 * When any is missing or malformed, alerts are "not set up yet": the API routes answer 503 and the
 * settings page says alerts aren't switched on.
 */
export interface AlertsEnv {
  vapidPublicKey: string;
  vapidPrivateKey: string;
  /** A contact for push services: the site's URL. */
  vapidSubject: string;
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  /** Supabase Cron sends it as "Authorization: Bearer …". */
  cronSecret: string;
}

const BASE64URL = /^[A-Za-z0-9_-]+$/;
const isKey = (value: string, bytes: number) =>
  BASE64URL.test(value) && Buffer.from(value, "base64url").length === bytes;

function problemWith(env: AlertsEnv): string | null {
  if (!isKey(env.vapidPublicKey, 65)) return "NEXT_PUBLIC_VAPID_PUBLIC_KEY isn't a VAPID public key";
  if (!isKey(env.vapidPrivateKey, 32)) return "VAPID_PRIVATE_KEY isn't a VAPID private key";
  if (!/^(https:\/\/|mailto:)/.test(env.vapidSubject)) return "VAPID_SUBJECT should be the site's https:// URL";
  if (!/^https?:\/\//.test(env.supabaseUrl)) return "SUPABASE_URL should look like https://xyz.supabase.co";
  if (env.cronSecret.length < 16) return "CRON_SECRET should be at least 16 characters";
  return null;
}

let warned = false;

export function readAlertsEnv(): AlertsEnv | null {
  const env = {
    // Written out in full: Next.js inlines NEXT_PUBLIC_ variables only when named like this.
    vapidPublicKey: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim() ?? "",
    vapidPrivateKey: process.env.VAPID_PRIVATE_KEY?.trim() ?? "",
    vapidSubject: process.env.VAPID_SUBJECT?.trim() ?? "",
    supabaseUrl: process.env.SUPABASE_URL?.trim() ?? "",
    supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "",
    cronSecret: process.env.CRON_SECRET?.trim() ?? "",
  };
  if (Object.values(env).some((value) => !value)) return null;
  const problem = problemWith(env);
  if (problem) {
    if (!warned) console.error(`Alerts are off: ${problem}.`);
    warned = true;
    return null;
  }
  return env;
}

/** What the settings page needs: whether alerts can work here, and the key browsers subscribe with. */
export function alertsClientConfig(): { configured: boolean; publicKey: string | null } {
  const env = readAlertsEnv();
  return { configured: env !== null, publicKey: env?.vapidPublicKey ?? null };
}
