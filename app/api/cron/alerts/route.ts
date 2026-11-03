import { runCron, type JobSources } from "@/app/_server/alerts/http";
import { alertServices } from "@/app/_server/alerts/services";
import { fileSpots } from "@/app/_server/alerts/spots";
import { getForecast } from "@/lib/forecast/getForecast";

// A few forecasts plus the sends: normally done in seconds.
export const maxDuration = 60;

const sources: JobSources = {
  forecastAt: (lat, lon, now) => getForecast(lat, lon, { now }),
  spotsNear: fileSpots(),
};

/**
 * POST /api/cron/alerts with "Authorization: Bearer <CRON_SECRET>". Supabase Cron calls it every
 * 15 minutes (supabase/schema.sql); it sends the alerts that are due and returns a summary.
 */
export async function POST(request: Request) {
  return runCron(request, alertServices(), sources);
}
