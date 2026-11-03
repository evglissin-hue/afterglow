import {
  CADENCE_MINUTES,
  alertDue,
  alertMessage,
  alertTtlSeconds,
  bestSpotFor,
  decideAlert,
  isTimeZone,
  walkRadiusKm,
  type AlertForecast,
  type AlertKind,
  type BestSpot,
} from "@/lib/alerts";
import { GRID_DEG } from "@/lib/forecast/getForecast";
import { roundTo } from "@/lib/geo";
import { nextSunset } from "@/lib/sun";
import type { PushSender } from "./push";
import type { SpotsNear } from "./spots";
import type { StoredSubscription, SubscriptionStore } from "./store";

export interface JobDeps {
  store: SubscriptionStore;
  sender: PushSender;
  /** The forecast for the coming sunset at a 0.1° cell, as of `now` (getForecast in production). */
  forecastAt: (lat: number, lon: number, now: Date) => Promise<AlertForecast>;
  spotsNear: SpotsNear;
  now?: Date;
  cadenceMinutes?: number;
}

export interface JobSummary {
  at: string;
  subscriptions: number;
  /** Subscriptions with a check due in this run. */
  due: number;
  /** Forecasts fetched: one per 0.1° cell with something due. */
  cells: number;
  forecastErrors: number;
  sent: Record<AlertKind, number>;
  /** Checks that decided not to send: the score is below the bar. */
  quiet: number;
  /** Checks another run had already made (the job ran twice in the same window). */
  alreadyDone: number;
  /** Subscriptions the push service no longer knows, now deleted. */
  removed: number;
  failed: number;
  /** The first few problems, for the logs. */
  errors: string[];
}

interface Cell {
  lat: number;
  lon: number;
  sunset: Date | null;
  due: StoredSubscription[];
}

const FALLBACK_ZONE = "Europe/London";
const MAX_ERRORS = 10;

const zoneOf = (sub: StoredSubscription) => (isTimeZone(sub.timezone) ? sub.timezone : FALLBACK_ZONE);
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Names a subscription in logs without its endpoint, which works like a password. */
function label(sub: StoredSubscription): string {
  try {
    return `${new URL(sub.endpoint).host}…${sub.endpoint.slice(-6)}`;
  } catch {
    return "subscription";
  }
}

/** Runs `fn` over `items`, at most `limit` at a time. */
async function eachLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await fn(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

/**
 * One run of the alert job (every 15 minutes): finds subscribers with a check due, fetches one
 * forecast per 0.1° cell, decides, saves each decision before sending, sends, and deletes
 * subscriptions the push service says are gone.
 *
 * Safe to run twice in the same window: each decision is saved with an atomic "only if not
 * already done today" update, and only the run that saves it sends.
 */
export async function runAlertJob(deps: JobDeps): Promise<JobSummary> {
  const now = deps.now ?? new Date();
  const cadenceMinutes = deps.cadenceMinutes ?? CADENCE_MINUTES;
  const summary: JobSummary = {
    at: now.toISOString(),
    subscriptions: 0,
    due: 0,
    cells: 0,
    forecastErrors: 0,
    sent: { "pre-sunset": 0, upgrade: 0, "happening-now": 0 },
    quiet: 0,
    alreadyDone: 0,
    removed: 0,
    failed: 0,
    errors: [],
  };
  const note = (problem: string) => {
    if (summary.errors.length < MAX_ERRORS) summary.errors.push(problem);
  };

  const subscriptions = await deps.store.list();
  summary.subscriptions = subscriptions.length;

  // Which subscribers have something due needs only the clock and sun times, so most runs stop here.
  const cells = new Map<string, Cell>();
  for (const sub of subscriptions) {
    const lat = roundTo(sub.lat, GRID_DEG);
    const lon = roundTo(sub.lon, GRID_DEG);
    const key = `${lat},${lon}`;
    let cell = cells.get(key);
    if (!cell) {
      cell = { lat, lon, sunset: nextSunset(now, lat, lon)?.sunset ?? null, due: [] };
      cells.set(key, cell);
    }
    if (!cell.sunset) continue;
    const due = alertDue({
      settings: sub.settings,
      state: sub.state,
      now,
      sunset: cell.sunset,
      timeZone: zoneOf(sub),
      cadenceMinutes,
    });
    if (due) cell.due.push(sub);
  }
  const busy = [...cells.values()].filter((cell) => cell.due.length > 0);
  summary.cells = busy.length;
  summary.due = busy.reduce((n, cell) => n + cell.due.length, 0);

  async function spotFor(sub: StoredSubscription, forecast: AlertForecast): Promise<BestSpot | null> {
    try {
      const { index, spots } = await deps.spotsNear(sub, walkRadiusKm(sub.walkMinutes));
      return bestSpotFor({
        spots,
        index,
        from: { lat: sub.lat, lon: sub.lon },
        walkMinutes: sub.walkMinutes,
        bearing: forecast.sun.bearing,
        favorites: sub.favorites,
      });
    } catch (error) {
      note(`spots near ${sub.lat},${sub.lon}: ${messageOf(error)}`);
      return null; // The alert still goes out, without a spot.
    }
  }

  async function handle(sub: StoredSubscription, forecast: AlertForecast) {
    const timeZone = zoneOf(sub);
    const decision = decideAlert({ settings: sub.settings, state: sub.state, now, forecast, timeZone, cadenceMinutes });
    if (!decision.kind) return;
    if (!decision.record || !decision.guard) {
      summary.quiet++;
      return;
    }
    // Save first: if another run already saved this check, it has sent (or skipped) it too.
    if (!(await deps.store.claim(sub.endpoint, decision.guard, decision.day, decision.record))) {
      summary.alreadyDone++;
      return;
    }
    if (!decision.send) {
      summary.quiet++;
      return;
    }

    const spot = decision.kind === "happening-now" ? null : await spotFor(sub, forecast);
    const message = alertMessage({ kind: decision.kind, forecast, spot, timeZone, now, day: decision.day });
    const result = await deps.sender.send(sub, message, {
      ttlSeconds: alertTtlSeconds(decision.kind, forecast, now),
      urgency: "high",
    });
    if (result.ok) {
      summary.sent[decision.kind]++;
      await deps.store.markOk(sub.endpoint, now);
    } else if (result.gone) {
      await deps.store.remove(sub.endpoint);
      summary.removed++;
    } else {
      summary.failed++;
      note(`send to ${label(sub)}: ${result.error}`);
    }
  }

  await eachLimit(busy, 4, async (cell) => {
    let forecast: AlertForecast;
    try {
      forecast = await deps.forecastAt(cell.lat, cell.lon, now);
    } catch (error) {
      // Nothing is saved, so a later run in the same window can still decide.
      summary.forecastErrors++;
      note(`forecast for ${cell.lat},${cell.lon}: ${messageOf(error)}`);
      return;
    }
    await eachLimit(cell.due, 8, (sub) =>
      handle(sub, forecast).catch((error: unknown) => {
        summary.failed++;
        note(`${label(sub)}: ${messageOf(error)}`);
      }),
    );
  });

  return summary;
}
