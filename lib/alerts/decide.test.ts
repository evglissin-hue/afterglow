import { describe, expect, it } from "vitest";
import { config } from "@/lib/forecast/config";
import { labelFor } from "@/lib/forecast/score";
import {
  ALERT_TIMING,
  DEFAULT_ALERT_SETTINGS,
  EMPTY_ALERT_STATE,
  alertDue,
  alertTtlSeconds,
  dayKey,
  decideAlert,
  minScoreFor,
  type AlertDecision,
  type AlertForecast,
  type AlertSettings,
  type AlertState,
} from ".";

const SUNSET = Date.parse("2026-11-03T16:29:54Z");
const TODAY = "2026-11-03";
const LONDON = "Europe/London";
const MIN = 60_000;

/** `minutes` before tonight's sunset (negative = after). */
const before = (minutes: number) => new Date(SUNSET - minutes * MIN);

function forecast(score: number): AlertForecast {
  return {
    score,
    label: labelFor(score),
    lookTitle: "Fiery orange and red",
    lookText: "Mid-level cloud catching the last light.",
    sun: {
      sunset: new Date(SUNSET).toISOString(),
      bestColor: { start: "2026-11-03T16:33:00.000Z", end: "2026-11-03T16:48:00.000Z" },
      bearing: 246,
    },
  };
}

function decide(
  now: Date,
  score: number,
  { settings = {}, state = {} }: { settings?: Partial<AlertSettings>; state?: Partial<AlertState> } = {},
): AlertDecision {
  return decideAlert({
    settings: { ...DEFAULT_ALERT_SETTINGS, ...settings },
    state: { ...EMPTY_ALERT_STATE, ...state },
    now,
    forecast: forecast(score),
    timeZone: LONDON,
  });
}

describe("thresholds", () => {
  it("come from the forecast's label table", () => {
    expect(minScoreFor("Good")).toBe(45);
    expect(minScoreFor("Great")).toBe(65);
    expect(minScoreFor("Epic")).toBe(85);
    for (const [min, label] of config.labels) expect(minScoreFor(label)).toBe(min);
  });
});

describe("the pre-sunset decision", () => {
  it("sends in the run that reaches sunset minus the lead time when the score clears the bar", () => {
    const d = decide(before(120), 74);
    expect(d).toMatchObject({ kind: "pre-sunset", send: true, day: TODAY, guard: "decidedOn" });
    expect(d.record).toEqual({ decidedOn: TODAY, decidedScore: 74, sentOn: TODAY, sentKind: "pre-sunset" });
  });

  it("records a no, with the score, so the day is never decided twice", () => {
    const d = decide(before(120), 64);
    expect(d).toMatchObject({ kind: "pre-sunset", send: false, guard: "decidedOn" });
    expect(d.record).toEqual({ decidedOn: TODAY, decidedScore: 64 });
    expect(d.reason).toBe("64 is below Great (65)");
  });

  it("uses the chosen bar and lead time", () => {
    expect(decide(before(60), 50, { settings: { minLabel: "Good", leadMinutes: 60 } }).send).toBe(true);
    expect(decide(before(180), 84, { settings: { minLabel: "Epic", leadMinutes: 180 } }).send).toBe(false);
    expect(decide(before(180), 85, { settings: { minLabel: "Epic", leadMinutes: 180 } }).send).toBe(true);
  });

  it("waits until the time comes", () => {
    expect(decide(before(121), 90).kind).toBeNull();
  });

  it("can be up to one run late, but no later", () => {
    expect(decide(before(120 - 15), 90).kind).toBe("pre-sunset");
    expect(decide(before(120 - 16), 90).kind).toBeNull();
  });

  it("is never made after sunset minus 15 minutes", () => {
    // With an hourly job, a 1 h lead would otherwise stretch to sunset itself.
    const hourly = (now: Date) =>
      alertDue({
        settings: { ...DEFAULT_ALERT_SETTINGS, leadMinutes: 60, happeningNow: false },
        state: EMPTY_ALERT_STATE,
        now,
        sunset: new Date(SUNSET),
        timeZone: LONDON,
        cadenceMinutes: 60,
      });
    expect(hourly(before(ALERT_TIMING.lastDecision))).toBe("pre-sunset");
    expect(hourly(before(ALERT_TIMING.lastDecision - 1))).toBeNull();
  });

  it("is made once a day: a decision today stops it, yesterday's doesn't", () => {
    expect(decide(before(115), 90, { state: { decidedOn: TODAY, decidedScore: 90, sentOn: TODAY } }).kind).toBeNull();
    expect(decide(before(115), 90, { state: { decidedOn: "2026-11-02", sentOn: "2026-11-02" } }).kind).toBe(
      "pre-sunset",
    );
  });
});

describe("upgrades", () => {
  const saidNo = { decidedOn: TODAY, decidedScore: 50 };

  it("send once when a later run sees the score clear the bar after a no", () => {
    const d = decide(before(60), 71, { state: saidNo });
    expect(d).toMatchObject({ kind: "upgrade", send: true, guard: "sentOn" });
    expect(d.record).toEqual({ sentOn: TODAY, sentKind: "upgrade" });
    expect(d.reason).toBe("up from 50 to 71, clears Great (65)");
    // Once sent, never again that day.
    expect(decide(before(45), 80, { state: { ...saidNo, ...d.record } }).kind).toBeNull();
  });

  it("stay quiet while the score is still below the bar", () => {
    const d = decide(before(60), 60, { state: saidNo });
    expect(d).toMatchObject({ kind: "upgrade", send: false, record: null, guard: null });
  });

  it("stop 30 minutes before sunset", () => {
    expect(decide(before(31), 90, { state: saidNo }).kind).toBe("upgrade");
    expect(decide(before(30), 90, { state: saidNo }).kind).toBeNull();
  });

  it("only follow a no, and only when switched on", () => {
    expect(decide(before(60), 90, { state: { decidedOn: TODAY, sentOn: TODAY } }).kind).toBeNull();
    expect(decide(before(60), 90, { state: saidNo, settings: { upgrades: false } }).kind).toBeNull();
    // No decision today (say, the subscription is new): nothing to upgrade.
    expect(decide(before(60), 90).kind).toBeNull();
  });
});

describe("happening now", () => {
  it("goes out in the run that reaches sunset minus 10 minutes after an alert today, even if the score dropped", () => {
    const d = decide(before(10), 20, { state: { decidedOn: TODAY, sentOn: TODAY } });
    expect(d).toMatchObject({ kind: "happening-now", send: true, guard: "nowCheckedOn" });
    expect(d.record).toEqual({ nowCheckedOn: TODAY, nowSentOn: TODAY });
  });

  it("goes out without an earlier alert when the score is still above the bar", () => {
    expect(decide(before(2), 70).send).toBe(true);
  });

  it("is checked once, sending nothing when the score is below the bar and no alert went out", () => {
    const d = decide(before(10), 40, { state: { decidedOn: TODAY, decidedScore: 40 } });
    expect(d).toMatchObject({ kind: "happening-now", send: false, record: { nowCheckedOn: TODAY } });
    expect(decide(before(5), 90, { state: { nowCheckedOn: TODAY } }).kind).toBeNull();
  });

  it("only runs in its window, and only when switched on", () => {
    expect(decide(before(11), 90).kind).toBeNull();
    expect(decide(before(10 - 15), 90).kind).toBe("happening-now");
    expect(decide(before(10 - 16), 90).kind).toBeNull();
    expect(decide(before(10), 90, { settings: { happeningNow: false } }).kind).toBeNull();
  });
});

describe("a whole day of runs", () => {
  /** Runs the job every 15 minutes from noon to 18:00, `repeat` times per slot, saving decisions like the store does. */
  function simulate(scoreAt: (now: Date) => number, settings: Partial<AlertSettings> = {}, repeat = 1) {
    let state: AlertState = { ...EMPTY_ALERT_STATE };
    const sent: { kind: string; at: string }[] = [];
    for (let t = Date.parse("2026-11-03T12:00:00Z"); t <= Date.parse("2026-11-03T18:00:00Z"); t += 15 * MIN) {
      for (let i = 0; i < repeat; i++) {
        const now = new Date(t + i * 1000);
        const d = decide(now, scoreAt(now), { settings, state });
        if (!d.record || !d.guard || state[d.guard] === d.day) continue;
        state = { ...state, ...d.record };
        if (d.send) sent.push({ kind: d.kind!, at: now.toISOString().slice(11, 16) });
      }
    }
    return sent;
  }

  it("says no at 14:30, upgrades when the score clears, then tells you it's happening", () => {
    const rising = (now: Date) => (now.getTime() < Date.parse("2026-11-03T15:00:00Z") ? 50 : 80);
    expect(simulate(rising)).toEqual([
      { kind: "upgrade", at: "15:00" },
      { kind: "happening-now", at: "16:30" },
    ]);
  });

  it("sends at most one pre-sunset or upgrade alert and one happening-now, even when runs repeat", () => {
    const flapping = (now: Date) => (Math.floor(now.getTime() / (15 * MIN)) % 2 ? 90 : 30);
    for (const leadMinutes of [60, 120, 180] as const) {
      const sent = simulate(flapping, { leadMinutes, minLabel: "Good" }, 3);
      expect(sent.filter((s) => s.kind !== "happening-now").length).toBeLessThanOrEqual(1);
      expect(sent.filter((s) => s.kind === "happening-now").length).toBeLessThanOrEqual(1);
    }
    expect(simulate(() => 90, {}, 3)).toEqual([
      { kind: "pre-sunset", at: "14:30" },
      { kind: "happening-now", at: "16:30" },
    ]);
  });

  it("stays quiet on a poor day", () => {
    expect(simulate(() => 20)).toEqual([]);
  });
});

describe("dates", () => {
  it("are the sunset's date in the subscriber's time zone", () => {
    const sunset = new Date(SUNSET);
    expect(dayKey(sunset, LONDON)).toBe("2026-11-03");
    expect(dayKey(sunset, "Pacific/Auckland")).toBe("2026-11-04");
    expect(dayKey(new Date("2026-06-21T23:30:00Z"), LONDON)).toBe("2026-06-22"); // BST
  });

  it("decide with that date, so another zone's 'today' isn't today", () => {
    const d = decideAlert({
      settings: DEFAULT_ALERT_SETTINGS,
      state: { ...EMPTY_ALERT_STATE, decidedOn: TODAY, decidedScore: 50 },
      now: before(120),
      forecast: forecast(70),
      timeZone: "Pacific/Auckland",
    });
    expect(d).toMatchObject({ kind: "pre-sunset", day: "2026-11-04" });
  });
});

describe("delivery time limits", () => {
  it("drop a pre-sunset alert at sunset and a happening-now alert after the best color", () => {
    expect(alertTtlSeconds("pre-sunset", forecast(70), before(120))).toBe(7200);
    // Best color ends at 16:48; five minutes' grace after that, counted from 16:19:54.
    expect(alertTtlSeconds("happening-now", forecast(70), before(10))).toBe(33 * 60 + 6);
    expect(alertTtlSeconds("upgrade", forecast(70), before(-60))).toBe(60);
  });
});
