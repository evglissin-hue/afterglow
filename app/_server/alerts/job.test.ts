import { describe, expect, it } from "vitest";
import {
  DEFAULT_ALERT_SETTINGS,
  EMPTY_ALERT_STATE,
  type AlertForecast,
  type AlertSettings,
  type PushMessage,
} from "@/lib/alerts";
import { getForecast } from "@/lib/forecast/getForecast";
import { labelFor } from "@/lib/forecast/score";
import { rankSpots, tileKey } from "@/lib/spots";
import { nextSunset } from "@/lib/sun";
import air from "@/lib/weather/__fixtures__/air-london-2026-11-03.json";
import recorded from "@/lib/weather/__fixtures__/forecast-london-2026-11-03.json";
import { runCron, type AlertServices } from "./http";
import { runAlertJob, type JobDeps } from "./job";
import type { PushSender, PushTarget, SendOptions, SendResult } from "./push";
import { fileSpots } from "./spots";
import { MemoryStore, type StoredSubscription } from "./store";

const MIN = 60_000;
const TODAY = "2026-11-03";

// Public places, not anyone's home: near Hilly Fields (Brockley) and Richmond.
const BROCKLEY = { lat: 51.46, lon: -0.03 }; // forecast cell 51.5, 0
const RICHMOND = { lat: 51.46, lon: -0.3 }; // forecast cell 51.5, -0.3
const SUNSET = nextSunset(new Date(`${TODAY}T12:00:00Z`), 51.5, 0)!.sunset.getTime();
const before = (minutes: number) => new Date(SUNSET - minutes * MIN);

function subscription(
  name: string,
  place = BROCKLEY,
  settings: Partial<AlertSettings> = {},
  extra: Partial<StoredSubscription> = {},
): StoredSubscription {
  return {
    endpoint: `https://fcm.googleapis.com/fcm/send/${name}`,
    keys: { p256dh: "BTest", auth: "test" },
    ...place,
    walkMinutes: 15,
    settings: { ...DEFAULT_ALERT_SETTINGS, ...settings },
    favorites: [],
    timezone: "Europe/London",
    state: { ...EMPTY_ALERT_STATE },
    lastOkAt: null,
    lastTestAt: null,
    ...extra,
  };
}

class FakeSender implements PushSender {
  sent: { endpoint: string; message: PushMessage; options: SendOptions }[] = [];
  answers = new Map<string, SendResult>();
  async send(target: PushTarget, message: PushMessage, options: SendOptions): Promise<SendResult> {
    this.sent.push({ endpoint: target.endpoint, message, options });
    return this.answers.get(target.endpoint) ?? { ok: true, status: 201 };
  }
}

/** A made-up forecast with the given score for whichever cell is asked, counting the calls. */
function scoredForecasts(score: (now: Date) => number) {
  const calls: string[] = [];
  const forecastAt = async (lat: number, lon: number, now: Date): Promise<AlertForecast> => {
    calls.push(`${lat},${lon}`);
    const sun = nextSunset(now, lat, lon)!;
    const s = score(now);
    return {
      score: s,
      label: labelFor(s),
      lookTitle: "Fiery orange and red",
      lookText: "Mid-level cloud catching the last light.",
      sun: {
        sunset: sun.sunset.toISOString(),
        bestColor: { start: sun.windows.mid.start.toISOString(), end: sun.windows.mid.end.toISOString() },
        bearing: Math.round(sun.bearing),
      },
    };
  };
  return { calls, forecastAt };
}

const spotsNear = fileSpots();

function deps(store: MemoryStore, sender: FakeSender, forecastAt: JobDeps["forecastAt"], now: Date): JobDeps {
  return { store, sender, forecastAt, spotsNear, now };
}

describe("the alert job", () => {
  it("sends the pre-sunset alert once, naming a real spot within the walk, and saves the decision", async () => {
    const store = new MemoryStore([
      subscription("brockley"),
      subscription("brockley-1h", BROCKLEY, { leadMinutes: 60 }),
      subscription("richmond-1h", RICHMOND, { leadMinutes: 60 }),
    ]);
    const sender = new FakeSender();
    const { calls, forecastAt } = scoredForecasts(() => 74);

    const summary = await runAlertJob(deps(store, sender, forecastAt, before(119)));

    expect(summary).toMatchObject({ subscriptions: 3, due: 1, cells: 1, failed: 0, quiet: 0 });
    expect(summary.sent).toEqual({ "pre-sunset": 1, upgrade: 0, "happening-now": 0 });
    expect(calls).toEqual(["51.5,0"]); // Only the cell with something due, once.
    expect(sender.sent).toHaveLength(1);
    const { message, options } = sender.sent[0];
    expect(message.title).toBe("Great sunset likely tonight (74)");
    expect(message.body).toMatch(
      /^Fiery orange and red\. Best near you: .+, \d+ min walk, (open horizon|low skyline|sky view)\. Leave by \d\d:\d\d\.$/,
    );
    expect(message.url).toMatch(/^\/spots\/\d+_-?\d+\/[0-9a-f]+$/);
    expect(message.tag).toBe(`afterglow-${TODAY}`);
    expect(options).toMatchObject({ urgency: "high" });
    expect(options.ttlSeconds).toBe(119 * 60);

    const saved = (await store.get(subscription("brockley").endpoint))!;
    expect(saved.state).toEqual({
      ...EMPTY_ALERT_STATE,
      decidedOn: TODAY,
      decidedScore: 74,
      sentOn: TODAY,
      sentKind: "pre-sunset",
    });
    expect(saved.lastOkAt).toBe(before(119).toISOString());

    // The next run in the same window has nothing left to do.
    const again = await runAlertJob(deps(store, sender, forecastAt, before(118)));
    expect(again).toMatchObject({ due: 0, cells: 0 });
    expect(sender.sent).toHaveLength(1);
  });

  it("names a favorite with an open view or low skyline over the top-ranked spot", async () => {
    const sender = new FakeSender();
    const { forecastAt } = scoredForecasts(() => 74);
    const plain = new MemoryStore([subscription("plain", BROCKLEY, {}, { walkMinutes: 30 })]);
    await runAlertJob(deps(plain, sender, forecastAt, before(119)));
    const top = sender.sent[0].message.url;

    // Make the second-best open or low-skyline spot within the walk a favorite.
    const { index, spots } = await spotsNear(BROCKLEY, 3);
    const forecast = await forecastAt(51.5, 0, before(119));
    const runnerUp = rankSpots(spots, BROCKLEY, forecast.sun.bearing, 30, index.profile).find(
      (r) => (r.view === "open" || r.view === "low") && `/spots/${tileKey(r.spot.lat, r.spot.lon, index.tile)}/${r.spot.id}` !== top,
    )!;
    const favorite = { id: runnerUp.spot.id, tile: tileKey(runnerUp.spot.lat, runnerUp.spot.lon, index.tile), name: "Mine" };
    const withFavorite = new MemoryStore([
      subscription("fav", BROCKLEY, {}, { walkMinutes: 30, favorites: [favorite] }),
    ]);
    await runAlertJob(deps(withFavorite, sender, forecastAt, before(119)));
    expect(sender.sent[1].message.url).toBe(`/spots/${favorite.tile}/${favorite.id}`);
    expect(sender.sent[1].message.body).toContain(`Best near you: ${runnerUp.spot.name}, ${runnerUp.walk} min walk`);
  });

  it("is safe to run twice at the same moment", async () => {
    const store = new MemoryStore([subscription("a"), subscription("b")]);
    const sender = new FakeSender();
    const { forecastAt } = scoredForecasts(() => 90);
    const [first, second] = await Promise.all([
      runAlertJob(deps(store, sender, forecastAt, before(119))),
      runAlertJob(deps(store, sender, forecastAt, before(119))),
    ]);
    expect(sender.sent.map((s) => s.endpoint).sort()).toEqual([
      subscription("a").endpoint,
      subscription("b").endpoint,
    ]);
    expect(first.sent["pre-sunset"] + second.sent["pre-sunset"]).toBe(2);
    expect(first.alreadyDone + second.alreadyDone).toBe(2);
  });

  it("says no, upgrades when the forecast improves, then says it's happening", async () => {
    const store = new MemoryStore([subscription("brockley")]);
    const sender = new FakeSender();
    const scores: Record<number, number> = { 120: 50, 105: 60, 90: 60, 75: 80, 60: 85, 10: 30 };
    const { forecastAt } = scoredForecasts((now) => scores[Math.round((SUNSET - now.getTime()) / MIN)] ?? 0);
    const runAt = (minutesBefore: number) => runAlertJob(deps(store, sender, forecastAt, before(minutesBefore)));

    expect(await runAt(120)).toMatchObject({ due: 1, quiet: 1 }); // 50: below Great, decided no
    expect(await runAt(105)).toMatchObject({ due: 1, quiet: 1 }); // 60: still below
    expect((await runAt(75)).sent.upgrade).toBe(1); // 80: upgrade
    expect(await runAt(60)).toMatchObject({ due: 0 }); // 85: already told today
    expect((await runAt(10)).sent["happening-now"]).toBe(1); // 30, but an alert went out today

    expect(sender.sent.map((s) => s.message.title)).toEqual([
      "Sunset now looks Great (80)",
      "It's happening: look west",
    ]);
    expect(sender.sent[1].message).toMatchObject({ url: "/", tag: `afterglow-${TODAY}-now` });
    expect(sender.sent[1].message.body).toMatch(/^Mid-level cloud catching the last light\. Best color until \d\d:\d\d\.$/);
    expect((await store.get(subscription("brockley").endpoint))!.state).toEqual({
      decidedOn: TODAY,
      decidedScore: 50,
      sentOn: TODAY,
      sentKind: "upgrade",
      nowCheckedOn: TODAY,
      nowSentOn: TODAY,
    });
  });

  it("deletes subscriptions the push service has dropped", async () => {
    const gone = subscription("gone");
    const store = new MemoryStore([gone, subscription("fine")]);
    const sender = new FakeSender();
    sender.answers.set(gone.endpoint, { ok: false, gone: true, status: 410, error: "Gone (410)" });
    const { forecastAt } = scoredForecasts(() => 90);
    const summary = await runAlertJob(deps(store, sender, forecastAt, before(119)));
    expect(summary).toMatchObject({ removed: 1, failed: 0 });
    expect(summary.sent["pre-sunset"]).toBe(1);
    expect(await store.get(gone.endpoint)).toBeNull();
  });

  it("counts other send failures without losing the rest", async () => {
    const flaky = subscription("flaky");
    const store = new MemoryStore([flaky, subscription("fine")]);
    const sender = new FakeSender();
    sender.answers.set(flaky.endpoint, { ok: false, gone: false, status: 500, error: "Server error (500)" });
    const { forecastAt } = scoredForecasts(() => 90);
    const summary = await runAlertJob(deps(store, sender, forecastAt, before(119)));
    expect(summary).toMatchObject({ failed: 1, removed: 0 });
    expect(summary.sent["pre-sunset"]).toBe(1);
    expect(summary.errors[0]).toMatch(/^send to fcm\.googleapis\.com…/);
    expect(summary.errors[0]).not.toContain(flaky.endpoint);
  });

  it("leaves a place's subscribers undecided when its forecast fails, so a later run can try again", async () => {
    const store = new MemoryStore([subscription("brockley"), subscription("richmond", RICHMOND)]);
    const sender = new FakeSender();
    const { forecastAt: working } = scoredForecasts(() => 90);
    const forecastAt: JobDeps["forecastAt"] = async (lat, lon, now) => {
      if (lon === -0.3) throw new Error("Weather data unavailable: HTTP 429");
      return working(lat, lon, now);
    };
    // Richmond's sunset is a minute later than Brockley's, so both are due here.
    const summary = await runAlertJob(deps(store, sender, forecastAt, before(117)));
    expect(summary).toMatchObject({ due: 2, cells: 2, forecastErrors: 1 });
    expect(summary.sent["pre-sunset"]).toBe(1);
    expect((await store.get(subscription("richmond", RICHMOND).endpoint))!.state).toEqual(EMPTY_ALERT_STATE);
  });

  it("works with the real forecast engine on recorded weather", async () => {
    const fixtureFetch = (async (url: string | URL | Request) =>
      new Response(JSON.stringify(String(url).includes("air-quality") ? air : recorded))) as typeof fetch;
    let fetches = 0;
    const forecastAt: JobDeps["forecastAt"] = (lat, lon, now) => {
      fetches++;
      return getForecast(lat, lon, { now, fetch: fixtureFetch });
    };
    const store = new MemoryStore([subscription("one"), subscription("two", { lat: 51.47, lon: -0.04 })]);
    const sender = new FakeSender();
    const now = before(119);
    const forecast = await getForecast(51.5, 0, { now, fetch: fixtureFetch });

    const summary = await runAlertJob(deps(store, sender, forecastAt, now));
    expect(summary).toMatchObject({ due: 2, cells: 1, forecastErrors: 0 });
    expect(fetches).toBe(1);
    // 3 Nov 2026 was a grey evening: decided no, nothing sent.
    expect(forecast.score).toBeLessThan(65);
    expect(summary.quiet).toBe(2);
    expect(sender.sent).toHaveLength(0);
    expect((await store.get(subscription("one").endpoint))!.state).toMatchObject({
      decidedOn: TODAY,
      decidedScore: forecast.score,
      sentOn: null,
    });
  });
});

describe("the cron route", () => {
  function services(store: MemoryStore, sender: FakeSender, now: Date): AlertServices {
    return {
      store,
      sender,
      cronSecret: "a-long-enough-cron-secret",
      forecastAt: scoredForecasts(() => 70).forecastAt,
      spotsNear,
      clock: () => now,
    };
  }
  const cron = (authorization?: string) =>
    new Request("http://localhost/api/cron/alerts", {
      method: "POST",
      headers: authorization ? { authorization } : {},
    });

  it("runs the job with the right secret and returns a summary", async () => {
    const store = new MemoryStore([subscription("brockley")]);
    const sender = new FakeSender();
    const response = await runCron(cron("Bearer a-long-enough-cron-secret"), services(store, sender, before(119)));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(body).toMatchObject({ ok: true, subscriptions: 1, due: 1, sent: { "pre-sunset": 1 } });
    expect(sender.sent).toHaveLength(1);
  });

  it("refuses a missing or wrong secret, and says when alerts aren't set up", async () => {
    const store = new MemoryStore([subscription("brockley")]);
    const sender = new FakeSender();
    for (const header of [undefined, "Bearer wrong", "a-long-enough-cron-secret", "Bearer a-long-enough-cron-secret2"]) {
      expect((await runCron(cron(header), services(store, sender, before(119)))).status).toBe(401);
    }
    const notSetUp = await runCron(cron("Bearer a-long-enough-cron-secret"), null);
    expect(notSetUp.status).toBe(503);
    expect(await notSetUp.json()).toEqual({ error: "Alerts aren't set up yet" });
    expect(sender.sent).toHaveLength(0);
  });

  it("reports a broken database as a failed run", async () => {
    const store = new MemoryStore();
    store.list = async () => {
      throw new Error("Supabase list failed: connection refused");
    };
    const response = await runCron(cron("Bearer a-long-enough-cron-secret"), services(store, new FakeSender(), before(119)));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ ok: false, error: "Supabase list failed: connection refused" });
  });
});
