import { alertServices } from "@/app/_server/alerts/services";
import { ArchiveNotSetUpError } from "@/app/_server/archive/store";
import { cellKey, eveningDate, nearestArchiveCell } from "@/lib/forecast/archive";

const DAY_MS = 86_400_000;

/**
 * GET /api/archive?lat=51.5&lon=-0.1&days=60
 * The forecasts kept for the archived cell nearest a place: for each evening, the one made before
 * sunset and the same sunset scored again afterwards (SPEC.md §5.7). Weather for public grid cells
 * only, so it needs no key. The export in My sunsets attaches these to the logs.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const lat = Number(params.get("lat") ?? 51.5);
  const lon = Number(params.get("lon") ?? -0.1);
  const days = Math.min(365, Math.max(1, Math.round(Number(params.get("days") ?? 60)) || 60));
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 85 || Math.abs(lon) > 180) {
    return Response.json({ error: "Pass lat and lon, e.g. ?lat=51.5&lon=-0.1" }, { status: 400 });
  }
  const services = await alertServices();
  if (!services?.archive) return Response.json({ error: "The archive isn't set up yet" }, { status: 503 });

  const cell = nearestArchiveCell({ lat, lon });
  try {
    const rows = await services.archive.list(cellKey(cell), eveningDate(new Date(Date.now() - days * DAY_MS)));
    return Response.json({ cell, rows }, { headers: { "Cache-Control": "public, s-maxage=900, stale-while-revalidate=600" } });
  } catch (error) {
    if (error instanceof ArchiveNotSetUpError) return Response.json({ error: error.message }, { status: 503 });
    console.error("Archive read failed:", error);
    return Response.json({ error: "Couldn't read the archive" }, { status: 502 });
  }
}
