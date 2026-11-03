import { ForecastError, getForecast } from "@/lib/forecast/getForecast";

/**
 * GET /api/forecast?lat=51.51&lon=-0.13
 * The app computes forecasts in the browser (each visitor uses their own Open-Meteo quota);
 * this endpoint serves the same data for the alert job and for debugging.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const lat = Number(params.get("lat"));
  const lon = Number(params.get("lon"));
  if (!params.has("lat") || !params.has("lon") || !Number.isFinite(lat) || !Number.isFinite(lon)) {
    return Response.json({ error: "Pass lat and lon, e.g. ?lat=51.51&lon=-0.13" }, { status: 400 });
  }
  if (Math.abs(lat) > 85 || Math.abs(lon) > 180) {
    return Response.json({ error: "lat or lon out of range" }, { status: 400 });
  }

  try {
    const forecast = await getForecast(lat, lon);
    return Response.json(forecast, {
      headers: { "Cache-Control": "public, s-maxage=1800, stale-while-revalidate=600" },
    });
  } catch (error) {
    if (error instanceof ForecastError) {
      const status = error.code === "no-sunset" ? 422 : 502;
      return Response.json({ error: error.message, code: error.code }, { status });
    }
    throw error;
  }
}
