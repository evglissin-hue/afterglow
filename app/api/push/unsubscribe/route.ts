import { unsubscribe } from "@/app/_server/alerts/http";
import { alertServices } from "@/app/_server/alerts/services";

/** POST /api/push/unsubscribe { endpoint }: switch alerts off for one device. */
export async function POST(request: Request) {
  return unsubscribe(request, await alertServices());
}
