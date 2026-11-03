import { describe, expect, it } from "vitest";
import { getForecast } from "@/lib/forecast/getForecast";
import air from "./__fixtures__/air-london-2026-11-03.json";
import forecast from "./__fixtures__/forecast-london-2026-11-03.json";
import {
  MODELS,
  airQualityUrl,
  forecastUrl,
  hourContaining,
  parseAirQuality,
  parseForecast,
  sumBefore,
  valueAt,
} from "./openmeteo";

// Fixtures are real Open-Meteo responses for 8 points along the 246° sunset line from
// central London, fetched on 3 Nov 2026.

describe("parsing Open-Meteo responses", () => {
  it("reads every model at every point", () => {
    const parsed = parseForecast(forecast, 8);
    for (const model of MODELS) {
      const series = parsed.models[model];
      expect(series, model).toHaveLength(8);
      expect(series![0].time.length).toBeGreaterThan(24);
      expect(series!.every((s) => s.low.every((v) => v === null || (v >= 0 && v <= 100)))).toBe(true);
    }
  });

  it("rejects a response with the wrong number of points", () => {
    expect(() => parseForecast(forecast, 3)).toThrow(/Expected 3 locations/);
  });

  it("reads aerosol optical depth", () => {
    const parsed = parseAirQuality(air)!;
    expect(parsed.aod.length).toBe(parsed.time.length);
    expect(parsed.aod.some((v) => v !== null && v > 0)).toBe(true);
  });

  it("builds request URLs", () => {
    const url = new URL(forecastUrl([{ lat: 51.5, lon: -0.1 }, { lat: 51.4, lon: -0.5 }]));
    expect(url.searchParams.get("latitude")).toBe("51.500,51.400");
    expect(url.searchParams.get("models")).toBe(MODELS.join(","));
    expect(new URL(airQualityUrl({ lat: 51.5, lon: -0.1 })).hostname).toBe("air-quality-api.open-meteo.com");
  });
});

describe("time helpers", () => {
  const time = [0, 3600, 7200, 10800];
  it("interpolates between hours", () => {
    expect(valueAt(time, [0, 100, 50, null], 1800)).toBe(50);
    expect(valueAt(time, [0, 100, 50, null], 9000)).toBe(50);
    expect(valueAt(time, [0, 100, 50, 20], 20000)).toBeNull();
  });
  it("finds the hour's rain and sums earlier hours", () => {
    expect(hourContaining(time, [0, 1, 2, 3], 5000)).toBe(2);
    expect(sumBefore(time, [5, 1, 2, 3], 7300, 2)).toBe(3);
  });
});

describe("getForecast with recorded data", () => {
  const fakeFetch = (async (url: string | URL | Request) => {
    const body = String(url).includes("air-quality") ? air : forecast;
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;

  it("produces a complete forecast", async () => {
    const result = await getForecast(51.507, -0.128, {
      now: new Date("2026-11-03T13:30:00Z"),
      fetch: fakeFetch,
    });
    expect(result.location).toMatchObject({ lat: 51.5, lon: -0.1 });
    const sunset = Date.parse(result.sun.sunset);
    expect(sunset).toBeGreaterThan(Date.parse("2026-11-03T16:25:00Z"));
    expect(sunset).toBeLessThan(Date.parse("2026-11-03T16:35:00Z"));
    expect(result.sun.compass).toBe("WSW");
    expect(result.models.map((m) => m.id)).toEqual([...MODELS]);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
    expect(result.path).toHaveLength(8);
    expect(result.why.length).toBeGreaterThan(0);
    expect(new Date(result.sun.bestColor.start) < new Date(result.sun.bestColor.end)).toBe(true);
  });

  it("reports when the weather service fails", async () => {
    const failing = (async () =>
      new Response(JSON.stringify({ error: true, reason: "Daily API request limit exceeded." }), {
        status: 429,
      })) as typeof fetch;
    await expect(getForecast(51.5, -0.1, { fetch: failing })).rejects.toMatchObject({
      code: "weather-unavailable",
      message: expect.stringContaining("Daily API request limit exceeded"),
    });
  });
});
