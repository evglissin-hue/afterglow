import { runCron, type JobSources } from "@/app/_server/alerts/http";
import { alertServices } from "@/app/_server/alerts/services";
import { fileSpots } from "@/app/_server/alerts/spots";
import { getForecast } from "@/lib/forecast/getForecast";

// A few forecasts plus the sends, and twice an evening the archive's five more: normally done in seconds.
export const maxDuration = 60;

const sources: JobSources = {
  forecastAt: (lat, lon, now) => getForecast(lat, lon, { now }),
  spotsNear: fileSpots(),
  forecastFor: (cell, sunset, now) => getForecast(cell.lat, cell.lon, { now, evening: sunset }),
};

/**
 * POST /api/cron/alerts with "Authorization: Bearer <CRON_SECRET>". Supabase Cron calls it every
 * 15 minutes (supabase/schema.sql); it sends the alerts that are due, keeps the evening's forecasts
 * for the archive (SPEC.md §5.7) and returns a summary.
 */
export async function POST(request: Request) {
  return runCron(request, await alertServices(), sources);
}
