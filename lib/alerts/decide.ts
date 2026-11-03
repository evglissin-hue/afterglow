import type { Forecast } from "@/lib/forecast/getForecast";
import { minScoreFor, type AlertSettings } from "./settings";

export type AlertKind = "pre-sunset" | "upgrade" | "happening-now";

/**
 * What a subscriber has already been told, as the sunset dates it was for (YYYY-MM-DD in the
 * subscriber's time zone). Only today's date counts; an older one just means "not today".
 */
export interface AlertState {
  /** The pre-sunset decision, made once a day whether or not it sent anything. */
  decidedOn: string | null;
  /** The score at that decision. */
  decidedScore: number | null;
  /** A pre-sunset or upgrade alert went out (at most one a day). */
  sentOn: string | null;
  sentKind: "pre-sunset" | "upgrade" | null;
  /** The happening-now check, made once a day whether or not it sent anything. */
  nowCheckedOn: string | null;
  /** A happening-now alert went out. */
  nowSentOn: string | null;
}

export const EMPTY_ALERT_STATE: AlertState = {
  decidedOn: null,
  decidedScore: null,
  sentOn: null,
  sentKind: null,
  nowCheckedOn: null,
  nowSentOn: null,
};

/** The alert job runs this often (Supabase Cron, supabase/schema.sql). */
export const CADENCE_MINUTES = 15;

/** Timing rules, in minutes before sunset. */
export const ALERT_TIMING = {
  /** The pre-sunset decision is never made later than this, even when the job runs late. */
  lastDecision: 15,
  /** Upgrades stop here: any later and there's no time to get anywhere. */
  lastUpgrade: 30,
  /** "It's happening" goes out in the run that reaches this. */
  happening: 10,
} as const;

/** The parts of a forecast that alerts use. A full `Forecast` fits. */
export type AlertForecast = Pick<Forecast, "score" | "label" | "lookTitle" | "lookText"> & {
  sun: Pick<Forecast["sun"], "sunset" | "bearing"> & { bestColor: Pick<Forecast["sun"]["bestColor"], "start" | "end"> };
};

/** The state field that must not already hold today's date when a decision is saved. */
export type AlertGuard = "decidedOn" | "sentOn" | "nowCheckedOn";

export interface AlertDecision {
  /** The check this run made, or null when nothing was due. */
  kind: AlertKind | null;
  send: boolean;
  /** The sunset's date in the subscriber's time zone. */
  day: string;
  /** What to save, before sending. Null when nothing changes. */
  record: Partial<AlertState> | null;
  /**
   * Save `record` only while this field isn't `day` yet, in one atomic update, so that two runs
   * in the same window can't both act.
   */
  guard: AlertGuard | null;
  /** Why, in a few words, for logs and tests. */
  reason: string;
}

const MINUTE = 60_000;

/** A date as YYYY-MM-DD in a time zone. */
export function dayKey(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export interface AlertTiming {
  settings: AlertSettings;
  state: AlertState;
  now: Date;
  sunset: Date;
  timeZone: string;
  /** Minutes between job runs. */
  cadenceMinutes?: number;
}

/**
 * Which check this run owes a subscriber, from the clock and what's already done. It needs no
 * forecast, so the job only fetches forecasts for places where something is due.
 *
 * - pre-sunset: the run where `now` first reaches sunset − lead (up to one cadence late, never
 *   after sunset − 15 min), once a day.
 * - upgrade: any later run before sunset − 30 min, after a "no" decision today.
 * - happening-now: the run that reaches sunset − 10 min, once a day.
 *
 * The windows don't overlap, so a run makes at most one check per subscriber.
 */
export function alertDue({
  settings,
  state,
  now,
  sunset,
  timeZone,
  cadenceMinutes = CADENCE_MINUTES,
}: AlertTiming): AlertKind | null {
  const day = dayKey(sunset, timeZone);
  const t = now.getTime();
  const s = sunset.getTime();
  const cadence = cadenceMinutes * MINUTE;

  const decideAt = s - settings.leadMinutes * MINUTE;
  const decideUntil = Math.min(decideAt + cadence, s - ALERT_TIMING.lastDecision * MINUTE);
  if (state.decidedOn !== day && t >= decideAt && t <= decideUntil) return "pre-sunset";

  if (
    settings.upgrades &&
    state.decidedOn === day &&
    state.sentOn !== day &&
    t < s - ALERT_TIMING.lastUpgrade * MINUTE
  ) {
    return "upgrade";
  }

  const happeningAt = s - ALERT_TIMING.happening * MINUTE;
  if (settings.happeningNow && state.nowCheckedOn !== day && t >= happeningAt && t <= happeningAt + cadence) {
    return "happening-now";
  }

  return null;
}

export interface DecideInput extends Omit<AlertTiming, "sunset"> {
  forecast: AlertForecast;
}

/** The decision for one subscriber in one job run (SPEC.md §3, US6). */
export function decideAlert(input: DecideInput): AlertDecision {
  const { settings, state, forecast } = input;
  const sunset = new Date(forecast.sun.sunset);
  const day = dayKey(sunset, input.timeZone);
  const kind = alertDue({ ...input, sunset });
  const { score } = forecast;
  const min = minScoreFor(settings.minLabel);
  const clears = score >= min;
  const bar = `${settings.minLabel} (${min})`;

  switch (kind) {
    case null:
      return { kind, send: false, day, record: null, guard: null, reason: "nothing due" };

    case "pre-sunset":
      return {
        kind,
        send: clears,
        day,
        // Saved either way, so the day is never decided twice.
        record: clears
          ? { decidedOn: day, decidedScore: score, sentOn: day, sentKind: "pre-sunset" }
          : { decidedOn: day, decidedScore: score },
        guard: "decidedOn",
        reason: clears ? `${score} clears ${bar}` : `${score} is below ${bar}`,
      };

    case "upgrade":
      return clears
        ? {
            kind,
            send: true,
            day,
            record: { sentOn: day, sentKind: "upgrade" },
            guard: "sentOn",
            reason: `up from ${state.decidedScore ?? "?"} to ${score}, clears ${bar}`,
          }
        : { kind, send: false, day, record: null, guard: null, reason: `${score} is still below ${bar}` };

    case "happening-now": {
      const alerted = state.sentOn === day;
      const send = alerted || clears;
      return {
        kind,
        send,
        day,
        record: send ? { nowCheckedOn: day, nowSentOn: day } : { nowCheckedOn: day },
        guard: "nowCheckedOn",
        reason: alerted ? "an alert went out today" : clears ? `${score} clears ${bar}` : `${score} is below ${bar}`,
      };
    }
  }
}

/**
 * How long a push service should keep trying to deliver an alert to a phone that's offline:
 * a pre-sunset alert is stale after sunset, "it's happening" once the best color is over.
 */
export function alertTtlSeconds(kind: AlertKind, forecast: AlertForecast, now: Date): number {
  const until =
    kind === "happening-now" ? Date.parse(forecast.sun.bestColor.end) + 5 * MINUTE : Date.parse(forecast.sun.sunset);
  return Math.max(60, Math.round((until - now.getTime()) / 1000));
}
