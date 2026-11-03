import { describe, expect, it } from "vitest";
import { destination } from "@/lib/geo";
import { labelFor } from "@/lib/forecast/score";
import { DEFAULT_PROFILE, type Spot } from "@/lib/spots";
import {
  alertMessage,
  bestSpotFor,
  cleanFavorites,
  isTimeZone,
  parseAlertSettings,
  parseFavorites,
  testMessage,
  type AlertForecast,
  type BestSpot,
} from ".";

const SUNSET = "2026-11-03T16:29:54.000Z";
const DAY = "2026-11-03";
const LONDON = "Europe/London";

function forecast(score: number, sunset = SUNSET): AlertForecast {
  const t = Date.parse(sunset);
  return {
    score,
    label: labelFor(score),
    lookTitle: "Fiery orange and red",
    lookText: "Mid-level cloud catching the last light.",
    sun: {
      sunset,
      bestColor: { start: new Date(t + 3 * 60_000).toISOString(), end: new Date(t + 18 * 60_000).toISOString() },
      bearing: 246,
    },
  };
}

const hillyFields: BestSpot = {
  id: "09404023",
  name: "Hilly Fields",
  tile: "1029_-1",
  walk: 8,
  view: "open",
  favorite: false,
};

describe("alert text", () => {
  const twoHoursBefore = new Date(Date.parse(SUNSET) - 120 * 60_000);

  it("names the label, score, look and best spot, with when to leave", () => {
    const message = alertMessage({
      kind: "pre-sunset",
      forecast: forecast(74),
      spot: hillyFields,
      timeZone: LONDON,
      now: twoHoursBefore,
      day: DAY,
    });
    expect(message).toEqual({
      title: "Great sunset likely tonight (74)",
      body: "Fiery orange and red. Best near you: Hilly Fields, 8 min walk, open horizon. Leave by 16:12.",
      url: "/spots/1029_-1/09404023",
      tag: "afterglow-2026-11-03",
    });
  });

  it("says the forecast improved for an upgrade", () => {
    const message = alertMessage({
      kind: "upgrade",
      forecast: forecast(71),
      spot: { ...hillyFields, view: "low", walk: 12 },
      timeZone: LONDON,
      now: twoHoursBefore,
      day: DAY,
    });
    expect(message.title).toBe("Sunset now looks Great (71)");
    expect(message.body).toBe(
      "Fiery orange and red. Best near you: Hilly Fields, 12 min walk, low skyline. Leave by 16:08.",
    );
  });

  it("says leave now once the leave-by time has passed", () => {
    const message = alertMessage({
      kind: "upgrade",
      forecast: forecast(90),
      spot: { ...hillyFields, walk: 30 },
      timeZone: LONDON,
      now: new Date(Date.parse(SUNSET) - 35 * 60_000),
      day: DAY,
    });
    expect(message.title).toBe("Sunset now looks Epic (90)");
    expect(message.body).toMatch(/30 min walk, open horizon\. Leave now\.$/);
  });

  it("gives sunset and best color times when there's no spot to name", () => {
    const message = alertMessage({
      kind: "pre-sunset",
      forecast: forecast(50),
      spot: null,
      timeZone: LONDON,
      now: twoHoursBefore,
      day: DAY,
    });
    expect(message).toEqual({
      title: "Good sunset likely tonight (50)",
      body: "Fiery orange and red. Sunset 16:30, best color 16:33–16:48.",
      url: "/",
      tag: "afterglow-2026-11-03",
    });
  });

  it("says it's happening, with a line from the look", () => {
    const message = alertMessage({
      kind: "happening-now",
      forecast: forecast(70),
      spot: hillyFields,
      timeZone: LONDON,
      now: new Date(Date.parse(SUNSET) - 10 * 60_000),
      day: DAY,
    });
    expect(message).toEqual({
      title: "It's happening: look west",
      body: "Mid-level cloud catching the last light. Best color until 16:48.",
      url: "/",
      tag: "afterglow-2026-11-03-now",
    });
  });

  it("formats times in the subscriber's time zone", () => {
    const june = forecast(70, "2026-06-21T20:21:10.000Z");
    const now = new Date("2026-06-21T18:21:00Z");
    const london = alertMessage({ kind: "pre-sunset", forecast: june, spot: null, timeZone: LONDON, now, day: "2026-06-21" });
    expect(london.body).toContain("Sunset 21:21"); // BST
    const utc = alertMessage({ kind: "pre-sunset", forecast: june, spot: null, timeZone: "UTC", now, day: "2026-06-21" });
    expect(utc.body).toContain("Sunset 20:21");
  });

  it("has a test message", () => {
    expect(testMessage("Great").body).toBe(
      "Alerts are on. You'll hear from us when tonight's sunset looks Great or better.",
    );
    expect(testMessage("Epic").body).toContain("looks Epic.");
  });
});

describe("the spot an alert names", () => {
  const home = { lat: 51.4625, lon: -0.03 };
  const index = { profile: DEFAULT_PROFILE, tile: { lat: 0.05, lon: 0.08 } };

  /** A park `km` east of home with the same obstacle angle all round. */
  function park(id: string, km: number, angle: number): Spot {
    const p = destination(home, 90, km);
    return { id, name: `Park ${id}`, kind: "park", ...p, score: 50, h: Array(51).fill(angle * 10) };
  }

  const far = park("far", 1.2, 0); // 19 min walk
  const open = park("open", 0.5, 0); // 8 min
  const low = park("low", 0.3, 3); // 5 min
  const blocked = park("blocked", 0.1, 20); // 2 min
  const spots = [far, open, low, blocked];
  const pick = (favoriteIds: string[] = [], walkMinutes = 15, from = spots) =>
    bestSpotFor({
      spots: from,
      index,
      from: home,
      walkMinutes,
      bearing: 246,
      favorites: favoriteIds.map((id) => ({ id, tile: "1029_-1", name: id })),
    });

  it("is the top of tonight's ranking within the walk", () => {
    expect(pick()).toMatchObject({ id: "open", walk: 8, view: "open", favorite: false, tile: "1029_-1" });
    expect(pick([], 30)?.id).toBe("open");
  });

  it("prefers a favorite with an open view or a low skyline tonight", () => {
    expect(pick(["low"])).toMatchObject({ id: "low", view: "low", favorite: true });
  });

  it("skips favorites that are blocked tonight or beyond the walk", () => {
    expect(pick(["blocked"])?.id).toBe("open");
    expect(pick(["far"])?.id).toBe("open");
  });

  it("never names a blocked spot", () => {
    expect(pick([], 15, [blocked])).toBeNull();
    expect(pick([], 15, [])).toBeNull();
  });
});

describe("reading settings", () => {
  it("accepts only the offered choices", () => {
    const good = { minLabel: "Epic", leadMinutes: 180, happeningNow: false, upgrades: true };
    expect(parseAlertSettings(good)).toEqual(good);
    expect(parseAlertSettings({ ...good, extra: 1 })).toEqual(good);
    expect(parseAlertSettings({ ...good, minLabel: "Fair" })).toBeNull();
    expect(parseAlertSettings({ ...good, leadMinutes: 90 })).toBeNull();
    expect(parseAlertSettings({ ...good, leadMinutes: "60" })).toBeNull();
    expect(parseAlertSettings({ ...good, upgrades: "yes" })).toBeNull();
    expect(parseAlertSettings(null)).toBeNull();
    expect(parseAlertSettings([good])).toBeNull();
  });

  it("checks favorites strictly from requests and leniently from storage", () => {
    const favorite = { id: "09404023", tile: "1029_-1", name: " Hilly Fields ", note: "x" };
    expect(parseFavorites([favorite])).toEqual([{ id: "09404023", tile: "1029_-1", name: "Hilly Fields" }]);
    expect(parseFavorites([favorite, { id: "../x", tile: "1029_-1", name: "Bad" }])).toBeNull();
    expect(parseFavorites([{ ...favorite, tile: "../../etc" }])).toBeNull();
    expect(parseFavorites("[]")).toBeNull();
    expect(parseFavorites(Array(51).fill(favorite))).toBeNull();
    expect(cleanFavorites([favorite, favorite, { id: 3 }, "x"])).toHaveLength(1);
    expect(cleanFavorites({})).toEqual([]);
  });

  it("knows real time zones", () => {
    expect(isTimeZone("Europe/London")).toBe(true);
    expect(isTimeZone("Mars/Olympus_Mons")).toBe(false);
    expect(isTimeZone(42)).toBe(false);
  });
});
