import { ForecastError } from "@/lib/forecast/getForecast";

/**
 * Shared by /api/forecast and /api/outlook: reads ?lat=…&lon=…, computes the result for that place
 * and answers with JSON the CDN may keep for 30 minutes. Bad parameters get a 400, a place where
 * the sun doesn't set a 422, and a weather failure a 502.
 */
export async function respondForPlace(
  request: Request,
  compute: (lat: number, lon: number) => Promise<unknown>,
): Promise<Response> {
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
    const result = await compute(lat, lon);
    return Response.json(result, {
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
