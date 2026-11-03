import { getOutlook } from "@/lib/forecast/getOutlook";
import { respondForPlace } from "../respondForPlace";

/**
 * GET /api/outlook?lat=51.51&lon=-0.13
 * Scores for the next five sunsets. The app computes these in the browser (each visitor uses their
 * own Open-Meteo quota); this endpoint is its fallback when the direct call fails.
 */
export async function GET(request: Request) {
  return respondForPlace(request, (lat, lon) => getOutlook(lat, lon));
}
