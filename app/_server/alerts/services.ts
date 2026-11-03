import { getForecast } from "@/lib/forecast/getForecast";
import { readAlertsEnv } from "./env";
import type { AlertServices } from "./http";
import { webPushSender } from "./push";
import { fileSpots } from "./spots";
import { supabaseStore } from "./supabase";

let services: AlertServices | null = null;

/** Supabase, web-push, the forecast and spot files, or null while alerts aren't set up. */
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
    forecastAt: (lat, lon, now) => getForecast(lat, lon, { now }),
    spotsNear: fileSpots(),
  };
  return services;
}
