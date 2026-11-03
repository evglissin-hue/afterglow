import { describe, expect, it } from "vitest";
import { sunEvents } from "@/lib/sun";
import {
  hengeDays,
  leaveBy,
  obstacleAt,
  rankSpots,
  sunHidesAt,
  tileKey,
  tilesAround,
  viewByMonth,
  viewFor,
  walkMinutes,
  type Spot,
  type SpotIndex,
} from ".";

const LONDON = { lat: 51.53, lon: -0.09 };

/** A spot whose obstacle angle is `angleAt(bearing)` degrees. */
function spot(angleAt: (bearing: number) => number, extra: Partial<Spot> = {}): Spot {
  return {
    id: "test",
    name: "Test spot",
    kind: "park",
    ...LONDON,
    score: 50,
    h: Array.from({ length: 51 }, (_, i) => Math.round(angleAt(220 + i * 2) * 10)),
    ...extra,
  };
}

const NOV_3 = sunEvents(new Date("2026-11-03T12:00:00Z"), LONDON.lat, LONDON.lon)!;

describe("reading a view profile", () => {
  const ramp = spot((b) => (b - 220) / 10); // 0° at 220°, 10° at 320°

  it("interpolates between bearings and knows its range", () => {
    expect(obstacleAt(ramp, 220)).toBe(0);
    expect(obstacleAt(ramp, 271)).toBeCloseTo(5.1, 5);
    expect(obstacleAt(ramp, 320)).toBe(10);
    expect(obstacleAt(ramp, 200)).toBeNull();
    expect(obstacleAt(ramp, 330)).toBeNull();
  });

  it("labels views by obstacle angle", () => {
    expect(viewFor(1.9)).toBe("open");
    expect(viewFor(4.9)).toBe("low");
    expect(viewFor(11)).toBe("sky");
    expect(viewFor(30)).toBe("blocked");
  });
});

describe("when the sun hides", () => {
  it("sets in view over an open horizon", () => {
    expect(sunHidesAt(spot(() => 0), NOV_3.sunset)).toBeNull();
  });

  it("ignores a tall building the sun passes behind earlier and comes out from", () => {
    // 30° tower toward 225°–231° (mid-afternoon sun), open toward the sunset.
    const tower = spot((b) => (b <= 231 ? 30 : 0));
    expect(sunHidesAt(tower, NOV_3.sunset)).toBeNull();
  });

  it("hides early behind a 4° skyline, about half an hour before sunset in November", () => {
    const hides = sunHidesAt(spot(() => 4), NOV_3.sunset)!;
    const minutesEarly = (NOV_3.sunset.getTime() - hides.getTime()) / 60_000;
    expect(minutesEarly).toBeGreaterThan(25);
    expect(minutesEarly).toBeLessThan(45);
  });
});

describe("seasons", () => {
  it("knows which months have an open view", () => {
    // Open only toward the south-west (sunsets from November to January).
    const months = viewByMonth(spot((b) => (b < 245 ? 0.5 : 20)), 2027);
    expect(months[11]).toBe("open"); // December, ~232°
    expect(months[5]).toBe("blocked"); // June, ~311°
  });

  it("finds the two days the sun sets straight down a street", () => {
    const days = hengeDays(spot(() => 20, { kind: "street", sb: 268 }), 2027);
    expect(days).toHaveLength(2);
    expect(days[0].getUTCMonth()).toBe(2); // March
    expect(days[1].getUTCMonth()).toBe(8); // September
  });
});

describe("walking", () => {
  it("estimates walking time and when to leave", () => {
    const tenMinutesAway = { lat: LONDON.lat, lon: LONDON.lon - 0.0092 }; // ~640 m west
    expect(walkMinutes(LONDON, tenMinutesAway)).toBe(10);
    expect(leaveBy(new Date("2026-11-03T16:30:00Z"), 10).toISOString()).toBe("2026-11-03T16:10:00.000Z");
  });

  it("ranks open views first, then the nearest", () => {
    const near = { lat: LONDON.lat, lon: LONDON.lon - 0.003 };
    const far = { lat: LONDON.lat, lon: LONDON.lon - 0.012 };
    const ranked = rankSpots(
      [
        spot(() => 20, { id: "blocked-near", ...near }),
        spot(() => 1, { id: "open-far", ...far }),
        spot(() => 1, { id: "open-near", ...near }),
        spot(() => 1, { id: "too-far", lat: 51.6, lon: -0.3 }),
      ],
      LONDON,
      246,
      15,
    );
    expect(ranked.map((r) => r.spot.id)).toEqual(["open-near", "open-far", "blocked-near"]);
    expect(ranked[0].view).toBe("open");
  });

  it("shows a street only on evenings the sun sets down it", () => {
    const street = (angle: number, id: string) => spot(() => angle, { id, kind: "street", sb: 246 });
    const ranked = rankSpots([street(1, "lined-up"), street(30, "not-tonight")], LONDON, 246, 15);
    expect(ranked.map((r) => r.spot.id)).toEqual(["lined-up"]);
  });
});

describe("tiles", () => {
  const index: SpotIndex = {
    version: 1,
    generated: "2026-11-03",
    profile: { from: 220, step: 2, count: 51 },
    tile: { lat: 0.05, lon: 0.08 },
    tiles: { "1030_-2": 45, "1030_-1": 30 },
  };

  it("matches the pipeline's tile keys", () => {
    expect(tileKey(51.5304, -0.0935, index.tile)).toBe("1030_-2");
  });

  it("lists only existing tiles near a point", () => {
    expect(tilesAround({ lat: 51.5304, lon: -0.0935 }, 1.5, index).sort()).toEqual(["1030_-1", "1030_-2"]);
    expect(tilesAround({ lat: 52.2, lon: 0.12 }, 1.5, index)).toEqual([]);
  });
});
