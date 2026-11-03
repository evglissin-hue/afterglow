import { getForecast } from "@/lib/forecast/getForecast";
import { respondForPlace } from "../respondForPlace";

/**
 * GET /api/forecast?lat=51.51&lon=-0.13
 * The app computes forecasts in the browser (each visitor uses their own Open-Meteo quota);
 * this endpoint serves the same data for the alert job and for debugging.
 */
export async function GET(request: Request) {
  return respondForPlace(request, (lat, lon) => getForecast(lat, lon));
}
