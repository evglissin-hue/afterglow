import { describe, expect, it } from "vitest";
import { compassPoint, destination, distanceKm } from "@/lib/geo";
import { nextSunset, sunEvents } from "@/lib/sun";

const LONDON = { lat: 51.5073, lon: -0.1276 };

/** Minutes between a Date and an ISO time. */
const minutesOff = (actual: Date, expectedIso: string) =>
  Math.abs(actual.getTime() - Date.parse(expectedIso)) / 60000;

// Reference values for London from the NOAA solar position algorithm (SPEC.md §5.1), in UTC.
const REFERENCE = [
  { day: "2026-12-21", sunset: "15:53", bearing: 232, high: ["15:59", "16:14"], dusk: "16:34", golden: "14:51" },
  { day: "2026-03-20", sunset: "18:13", bearing: 271, high: ["18:18", "18:30"], dusk: "18:47", golden: "17:29" },
  { day: "2026-06-21", sunset: "20:21", bearing: 311, high: ["20:27", "20:45"], dusk: "21:09", golden: "19:27" },
  { day: "2026-11-03", sunset: "16:30", bearing: 246, high: ["16:34", "16:48"], dusk: "17:05", golden: "15:40" },
];

describe("sunEvents (London)", () => {
  for (const ref of REFERENCE) {
    it(`matches reference times on ${ref.day}`, () => {
      const ev = sunEvents(new Date(`${ref.day}T12:00:00Z`), LONDON.lat, LONDON.lon);
      expect(ev).not.toBeNull();
      const iso = (hhmm: string) => `${ref.day}T${hhmm}:30Z`;
      expect(minutesOff(ev!.sunset, iso(ref.sunset))).toBeLessThan(2);
      expect(minutesOff(ev!.goldenStart, iso(ref.golden))).toBeLessThan(2);
      expect(minutesOff(ev!.lastLight, iso(ref.dusk))).toBeLessThan(2);
      expect(minutesOff(ev!.windows.high.start, iso(ref.high[0]))).toBeLessThan(2);
      expect(minutesOff(ev!.windows.high.end, iso(ref.high[1]))).toBeLessThan(2);
      expect(Math.abs(ev!.bearing - ref.bearing)).toBeLessThan(1.5);
    });
  }

  it("orders the windows sensibly", () => {
    const ev = sunEvents(new Date("2026-11-03T12:00:00Z"), LONDON.lat, LONDON.lon)!;
    expect(ev.goldenStart < ev.sunset).toBe(true);
    expect(ev.windows.mid.start < ev.sunset).toBe(true);
    expect(ev.windows.clear.start.getTime()).toBe(ev.sunset.getTime());
    expect(ev.windows.high.end < ev.lastLight).toBe(true);
    expect(ev.windows.high.start > ev.windows.mid.start).toBe(true);
  });
});

describe("nextSunset", () => {
  it("returns today's sunset before last light", () => {
    const ev = nextSunset(new Date("2026-11-03T16:50:00Z"), LONDON.lat, LONDON.lon)!;
    expect(ev.sunset.toISOString().slice(0, 10)).toBe("2026-11-03");
  });

  it("rolls over to tomorrow after last light", () => {
    const ev = nextSunset(new Date("2026-11-03T17:30:00Z"), LONDON.lat, LONDON.lon)!;
    expect(ev.sunset.toISOString().slice(0, 10)).toBe("2026-11-04");
  });

  it("returns null when the sun never sets", () => {
    expect(sunEvents(new Date("2026-06-21T12:00:00Z"), 78.2, 15.6)).toBeNull();
  });
});

describe("geo helpers", () => {
  it("finds points along a bearing", () => {
    const west = destination(LONDON, 270, 100);
    expect(distanceKm(LONDON, west)).toBeCloseTo(100, 0);
    expect(west.lon).toBeLessThan(LONDON.lon - 1.3);
    const behind = destination(LONDON, 270, -25);
    expect(behind.lon).toBeGreaterThan(LONDON.lon);
  });

  it("names compass points", () => {
    expect(compassPoint(246)).toBe("WSW");
    expect(compassPoint(311)).toBe("NW");
    expect(compassPoint(359)).toBe("N");
  });
});
