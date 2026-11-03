import { subscribe } from "@/app/_server/alerts/http";
import { alertServices } from "@/app/_server/alerts/services";

/** POST /api/push/subscribe { subscription, settings, place, timezone, favorites }: switch alerts on or save settings. */
export async function POST(request: Request) {
  return subscribe(request, alertServices());
}
