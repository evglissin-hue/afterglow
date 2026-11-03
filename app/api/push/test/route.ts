import { sendTest } from "@/app/_server/alerts/http";
import { alertServices } from "@/app/_server/alerts/services";

/** POST /api/push/test { endpoint }: a test alert to that device, at most one a minute. */
export async function POST(request: Request) {
  return sendTest(request, alertServices());
}
