import { readAlertsEnv } from "./env";
import type { AlertServices } from "./http";
import { webPushSender } from "./push";
import { supabaseStore } from "./supabase";

let services: AlertServices | null = null;

/** Supabase and web-push, set up from the environment, or null while alerts aren't set up. */
export function alertServices(): AlertServices | null {
  if (services) return services;
  const env = readAlertsEnv();
  if (!env) return null;
  services = {
    store: supabaseStore(env.supabaseUrl, env.supabaseServiceRoleKey),
    sender: webPushSender({
      subject: env.vapidSubject,
      publicKey: env.vapidPublicKey,
      privateKey: env.vapidPrivateKey,
    }),
    cronSecret: env.cronSecret,
  };
  return services;
}
