import { createClient } from "@supabase/supabase-js";
import webpush from "web-push";

/**
 * The alert server's own secrets, kept in a private table (`app_settings`, supabase/schema.sql) so
 * nobody has to make them by hand: the push (VAPID) keys, made here the first time they're needed,
 * and the secret Supabase's 15-minute job sends, made by schema.sql.
 */
export interface AlertSecrets {
  vapidPublicKey: string;
  vapidPrivateKey: string;
  cronSecret: string;
}

const TABLE = "app_settings";
/** Both push keys in one row, so they can't get out of step. */
const VAPID_ROW = "vapid";
const CRON_ROW = "cron_secret";

const BASE64URL = /^[A-Za-z0-9_-]+$/;
export const isVapidKey = (value: unknown, bytes: number): value is string =>
  typeof value === "string" && BASE64URL.test(value) && Buffer.from(value, "base64url").length === bytes;

function parseVapid(value: string | undefined): { publicKey: string; privateKey: string } | null {
  try {
    const keys = JSON.parse(value ?? "null") as { publicKey?: unknown; privateKey?: unknown } | null;
    return keys && isVapidKey(keys.publicKey, 65) && isVapidKey(keys.privateKey, 32)
      ? { publicKey: keys.publicKey, privateKey: keys.privateKey }
      : null;
  } catch {
    return null;
  }
}

/**
 * Reads the secrets, making the push keys on first use. When two servers start at once, both save
 * with "ignore if there already is one" and then read back, so they end up with the same keys.
 */
export async function loadAlertSecrets(url: string, serviceKey: string, fetchImpl?: typeof fetch): Promise<AlertSecrets> {
  const client = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    ...(fetchImpl ? { global: { fetch: fetchImpl } } : {}),
  });
  const read = async () => {
    const { data, error } = await client.from(TABLE).select("key,value").in("key", [VAPID_ROW, CRON_ROW]);
    if (error) throw new Error(`Couldn't read ${TABLE} (has supabase/schema.sql been run?): ${error.message}`);
    return new Map((data ?? []).map((row: { key: string; value: string }) => [row.key, row.value]));
  };

  let rows = await read();
  if (!parseVapid(rows.get(VAPID_ROW))) {
    const { publicKey, privateKey } = webpush.generateVAPIDKeys();
    const { error } = await client
      .from(TABLE)
      .upsert({ key: VAPID_ROW, value: JSON.stringify({ publicKey, privateKey }) }, { onConflict: "key", ignoreDuplicates: true });
    if (error) throw new Error(`Couldn't save the push keys: ${error.message}`);
    rows = await read();
  }

  const vapid = parseVapid(rows.get(VAPID_ROW));
  const cronSecret = rows.get(CRON_ROW) ?? "";
  if (!vapid) throw new Error(`The push keys in ${TABLE} aren't valid`);
  if (cronSecret.length < 16) throw new Error(`No cron secret in ${TABLE}: run supabase/schema.sql`);
  return { vapidPublicKey: vapid.publicKey, vapidPrivateKey: vapid.privateKey, cronSecret };
}
