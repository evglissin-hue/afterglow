import { runCron } from "@/app/_server/alerts/http";
import { alertServices } from "@/app/_server/alerts/services";

// A few forecasts plus the sends: normally done in seconds.
export const maxDuration = 60;

/**
 * POST /api/cron/alerts with "Authorization: Bearer <CRON_SECRET>". Supabase Cron calls it every
 * 15 minutes (supabase/schema.sql); it sends the alerts that are due and returns a summary.
 */
export async function POST(request: Request) {
  return runCron(request, alertServices());
}
