import { describe, expect, it } from "vitest";
import { getPosition } from "suncalc";
import { SUN_UP_ALTITUDE, sunEvents, sunPath } from "@/lib/sun";

const LONDON = { lat: 51.5073, lon: -0.1276 };
const NOV_3 = sunEvents(new Date("2026-11-03T12:00:00Z"), LONDON.lat, LONDON.lon)!;

describe("sunPath", () => {
  const from = new Date("2026-11-03T14:00:00Z");
  const path = sunPath(from, NOV_3.sunset, LONDON.lat, LONDON.lon);

  it("runs from now to sunset, every 5 minutes on the clock", () => {
    expect(path[0].time.getTime()).toBe(from.getTime());
    expect(path.at(-1)!.time.getTime()).toBe(NOV_3.sunset.getTime());
    expect(path[1].time.toISOString()).toBe("2026-11-03T14:05:00.000Z");
    expect(path.at(-2)!.time.toISOString()).toBe("2026-11-03T16:25:00.000Z");
    expect(path).toHaveLength(31);
  });

  it("sinks toward the sunset point through the afternoon", () => {
    expect(path[0].altitude).toBeCloseTo(17.1, 1);
    for (let i = 1; i < path.length; i++) {
      expect(path[i].azimuth).toBeGreaterThan(path[i - 1].azimuth);
      expect(path[i].altitude).toBeLessThan(path[i - 1].altitude);
    }
    expect(path.at(-1)!.azimuth).toBeCloseTo(NOV_3.bearing, 6);
    expect(path.at(-1)!.altitude).toBeCloseTo(SUN_UP_ALTITUDE, 2);
  });

  it("lines up with the clock when it starts between steps", () => {
    const odd = sunPath(new Date("2026-11-03T14:02:30Z"), new Date("2026-11-03T14:20:00Z"), LONDON.lat, LONDON.lon);
    expect(odd.map((p) => p.time.toISOString().slice(11, 19))).toEqual([
      "14:02:30",
      "14:05:00",
      "14:10:00",
      "14:15:00",
      "14:20:00",
    ]);
  });

  it("is empty after sunset, and a single point for an instant", () => {
    const later = new Date(NOV_3.sunset.getTime() + 60_000);
    expect(sunPath(later, NOV_3.sunset, LONDON.lat, LONDON.lon)).toEqual([]);
    expect(sunPath(NOV_3.sunset, NOV_3.sunset, LONDON.lat, LONDON.lon)).toHaveLength(1);
  });
});

describe("SUN_UP_ALTITUDE", () => {
  it("is where SunCalc's sunset puts the sun, all year", () => {
    for (const day of ["2026-03-20", "2026-06-21", "2026-11-03", "2026-12-21"]) {
      const ev = sunEvents(new Date(`${day}T12:00:00Z`), LONDON.lat, LONDON.lon)!;
      expect(getPosition(ev.sunset, LONDON.lat, LONDON.lon).altitude).toBeCloseTo(SUN_UP_ALTITUDE, 2);
      const minuteBefore = new Date(ev.sunset.getTime() - 60_000);
      expect(getPosition(minuteBefore, LONDON.lat, LONDON.lon).altitude).toBeGreaterThan(SUN_UP_ALTITUDE);
    }
  });
});
