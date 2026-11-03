import { readSupabaseEnv, secretOverrides, vapidSubject } from "./env";
import type { AlertServices } from "./http";
import { webPushSender } from "./push";
import { loadAlertSecrets } from "./secrets";
import { supabaseStore } from "./supabase";

let ready: Promise<AlertServices | null> | null = null;

/**
 * Supabase and web-push, set up from the environment and the secrets kept in the database, or null
 * while alerts aren't set up. A failure (say, schema.sql hasn't been run yet) is retried next time.
 */
export function alertServices(): Promise<AlertServices | null> {
  ready ??= build().catch((error: unknown) => {
    console.error(`Alerts are off: ${error instanceof Error ? error.message : String(error)}`);
    ready = null;
    return null;
  });
  return ready;
}

async function build(): Promise<AlertServices | null> {
  const env = readSupabaseEnv();
  if (!env) return null;
  const secrets = { ...(await loadAlertSecrets(env.url, env.serviceKey)), ...secretOverrides() };
  return {
    store: supabaseStore(env.url, env.serviceKey),
    sender: webPushSender({ subject: vapidSubject(), publicKey: secrets.vapidPublicKey, privateKey: secrets.vapidPrivateKey }),
    cronSecret: secrets.cronSecret,
    publicKey: secrets.vapidPublicKey,
  };
}
