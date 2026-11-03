import { connection } from "next/server";
import { alertServices } from "@/app/_server/alerts/services";

/**
 * GET /api/push/config: whether alerts work here, and the push key browsers subscribe with. The
 * settings page asks at run time, because the key lives in the database, not in the build.
 */
export async function GET() {
  await connection();
  const services = await alertServices();
  const publicKey = services?.publicKey ?? null;
  return Response.json({ configured: publicKey !== null, publicKey }, { headers: { "Cache-Control": "no-store" } });
}
