import { describe, expect, it } from "vitest";
import { nextSunset } from "@/lib/sun";
import recordedAir from "@/lib/weather/__fixtures__/air-london-2026-11-03-5day.json";
import recordedForecast from "@/lib/weather/__fixtures__/forecast-london-2026-11-03-5day.json";
import { MODELS, parseAirQuality, parseForecast, type ModelId } from "@/lib/weather/openmeteo";
import { sampleLine, scoreEvening } from "./evening";
import { getForecast } from "./getForecast";
import { getOutlook, localDate } from "./getOutlook";
import { LOOKS, labelFor } from "./score";

// Fixtures: real Open-Meteo responses fetched at 20:12 UTC on 3 Nov 2026, after that evening's last
// light, with the requests getOutlook makes at that moment: 8 points along the 245.7° line of the
// 4 Nov sunset from central London, and forecast_hours=119, so hourly data from 13:00 UTC on 3 Nov
// to 18:00 UTC on 8 Nov. All three models cover all five evenings. CAMS air quality stops at
// 00:00 UTC on 8 Nov, before the fifth sunset. Other cases are derived from these in the tests below.

const RECORDED_AT = "2026-11-03T20:12:00Z";
/** Rounds to the 51.5, −0.1 grid cell the fixtures were fetched for. */
const HERE = { lat: 51.507, lon: -0.128 };
const FROM_4_NOV = ["2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08"];

type Location = { hourly: { time: number[] } & Record<string, (number | null)[]> };
const copyForecast = () => structuredClone(recordedForecast) as unknown as Location[];

/** Answers like Open-Meteo with the given bodies, and keeps the URLs asked for. */
function fakeOpenMeteo({ forecast = recordedForecast as unknown, air = recordedAir as unknown, airStatus = 200 } = {}) {
  const urls: string[] = [];
  const fetch = (async (url: string | URL | Request) => {
    urls.push(String(url));
    const isAir = String(url).includes("air-quality");
    return new Response(JSON.stringify(isAir ? air : forecast), { status: isAir ? airStatus : 200 });
  }) as typeof globalThis.fetch;
  return { fetch, urls };
}

function outlookFor(responses: Parameters<typeof fakeOpenMeteo>[0] = {}, now = RECORDED_AT) {
  return getOutlook(HERE.lat, HERE.lon, { now: new Date(now), fetch: fakeOpenMeteo(responses).fetch });
}

/** The recording with these models' cloud cover set to null from `fromIso` on, as Open-Meteo does past the end of a model's run. */
function blankCloud(models: readonly ModelId[], fromIso: string) {
  const from = Date.parse(fromIso) / 1000;
  const copy = copyForecast();
  for (const { hourly } of copy) {
    hourly.time.forEach((t, i) => {
      if (t < from) return;
      for (const model of models) {
        for (const layer of ["low", "mid", "high"]) hourly[`cloud_cover_${layer}_${model}`][i] = null;
      }
    });
  }
  return copy;
}

/** The recording without any of one model's data, as if it had never been asked for. */
function withoutModel(model: ModelId) {
  const copy = copyForecast();
  for (const { hourly } of copy) {
    for (const key of Object.keys(hourly)) if (key.endsWith(`_${model}`)) delete hourly[key];
  }
  return copy;
}

describe("getOutlook with recorded data", () => {
  it("scores the next five sunsets in order, from one weather and one air request", async () => {
    const api = fakeOpenMeteo();
    const outlook = await getOutlook(HERE.lat, HERE.lon, { now: new Date(RECORDED_AT), fetch: api.fetch });

    expect(outlook.location).toEqual({ lat: 51.5, lon: -0.1, timezone: "Europe/London" });
    expect(outlook.days.map((d) => d.date)).toEqual(FROM_4_NOV);
    const sunsets = outlook.days.map((d) => Date.parse(d.sunset));
    for (let i = 1; i < sunsets.length; i++) {
      const hoursApart = (sunsets[i] - sunsets[i - 1]) / 3_600_000;
      expect(hoursApart).toBeGreaterThan(23.9);
      expect(hoursApart).toBeLessThan(24);
    }
    for (const day of outlook.days) {
      expect(day.sunset.slice(0, 10)).toBe(day.date); // London is on UTC in November
      expect(day.score).toBeGreaterThanOrEqual(0);
      expect(day.score).toBeLessThanOrEqual(100);
      expect(day.label).toBe(labelFor(day.score));
      expect(day.lookTitle).toBe(LOOKS[day.look].title);
    }
    // More than three days ahead, the models' agreement doesn't count for much.
    expect(outlook.days.slice(3).map((d) => d.confidence)).toEqual(["low", "low"]);

    // One request to each API, reaching just past the last evening: the requests recorded.
    expect(api.urls).toHaveLength(2);
    for (const url of api.urls) expect(new URL(url).searchParams.get("forecast_hours")).toBe("119");
  });

  it("starts with the sunset getForecast shows, scored the same", async () => {
    // In the morning, between sunset and last light, and the evening before (after last light).
    for (const now of ["2026-11-04T09:00:00Z", "2026-11-04T16:45:00Z", RECORDED_AT]) {
      const api = fakeOpenMeteo();
      const outlook = await getOutlook(HERE.lat, HERE.lon, { now: new Date(now), fetch: api.fetch });
      const tonight = await getForecast(HERE.lat, HERE.lon, { now: new Date(now), fetch: api.fetch });
      expect(outlook.days[0], now).toEqual({
        date: "2026-11-04",
        sunset: tonight.sun.sunset,
        score: tonight.score,
        label: tonight.label,
        look: tonight.look,
        lookTitle: tonight.lookTitle,
        confidence: tonight.confidence,
      });
    }
  });

  it("keeps the days straight across midnight and rolls over at last light", async () => {
    const dates = async (now: string) => (await outlookFor({}, now)).days.map((d) => d.date);
    expect(await dates("2026-11-03T23:59:00Z")).toEqual(FROM_4_NOV);
    expect(await dates("2026-11-04T00:01:00Z")).toEqual(FROM_4_NOV);
    // Last light on 4 Nov is at 17:03 UTC.
    expect(await dates("2026-11-04T16:59:00Z")).toEqual(FROM_4_NOV);
    // After it, the outlook starts the next day. The recording ends before the fifth of those
    // evenings (9 Nov), so no model covers it and it's left out.
    expect(await dates("2026-11-04T17:10:00Z")).toEqual(FROM_4_NOV.slice(1));

    // Dates are in the timezone Open-Meteo gives for the place, not UTC: relabeled as Tokyo
    // (9 h ahead), the same sunsets fall after local midnight, on the following dates.
    const tokyo = copyForecast().map((location) => ({ ...location, timezone: "Asia/Tokyo" }));
    const relabeled = await outlookFor({ forecast: tokyo });
    expect(relabeled.location.timezone).toBe("Asia/Tokyo");
    expect(relabeled.days.map((d) => d.date)).toEqual(["2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08", "2026-11-09"]);
  });

  it("scores evenings without air quality when the air forecast doesn't reach them", async () => {
    const noAir = await outlookFor({ airStatus: 500 });
    expect(noAir.days.map((d) => d.date)).toEqual(FROM_4_NOV);

    // Make the recorded air hazy (AOD 0.8, like a smoke plume) wherever CAMS has data: the first four
    // evenings change, the fifth, beyond CAMS, is scored exactly as without air quality.
    const hazy = structuredClone(recordedAir);
    hazy.hourly.aerosol_optical_depth = hazy.hourly.aerosol_optical_depth.map((v) => (v === null ? null : 0.8));
    const withHaze = await outlookFor({ air: hazy });
    expect(withHaze.days.slice(0, 4)).not.toEqual(noAir.days.slice(0, 4));
    expect(withHaze.days[4]).toEqual(noAir.days[4]);

    // The same, one level down: the fifth evening reads no AOD at all.
    const origin = { lat: 51.5, lon: -0.1 };
    const coords = sampleLine(origin, nextSunset(new Date(RECORDED_AT), origin.lat, origin.lon)!.bearing);
    const weather = { forecast: parseForecast(recordedForecast, 8), air: parseAirQuality(recordedAir) };
    const aodOn = (i: number) =>
      scoreEvening(weather, coords, new Date(noAir.days[i].sunset), new Date(RECORDED_AT))!.shown.input.observer.aod;
    expect(aodOn(3)).toBeGreaterThan(0);
    expect(aodOn(4)).toBeNull();
  });

  it("drops a model from the evenings it doesn't reach", async () => {
    // As if the UK Met Office run ended at midnight before 6 Nov.
    const partial = await outlookFor({ forecast: blankCloud(["ukmo_seamless"], "2026-11-06T00:00:00Z") });
    const full = await outlookFor();
    const noUkmo = await outlookFor({ forecast: withoutModel("ukmo_seamless") });

    expect(partial.days.map((d) => d.date)).toEqual(FROM_4_NOV);
    expect(partial.days.slice(0, 2)).toEqual(full.days.slice(0, 2));
    expect(partial.days.slice(2)).toEqual(noUkmo.days.slice(2));
    expect(noUkmo.days.slice(2)).not.toEqual(full.days.slice(2));
  });

  it("leaves out evenings no model covers", async () => {
    const outlook = await outlookFor({ forecast: blankCloud(MODELS, "2026-11-07T00:00:00Z") });
    expect(outlook.days.map((d) => d.date)).toEqual(FROM_4_NOV.slice(0, 3));

    await expect(outlookFor({ forecast: blankCloud(MODELS, "2026-11-03T00:00:00Z") })).rejects.toMatchObject({
      code: "weather-incomplete",
    });
  });

  it("asks for only as many hours as the evenings need", async () => {
    const api = fakeOpenMeteo();
    const outlook = await getOutlook(HERE.lat, HERE.lon, { now: new Date(RECORDED_AT), fetch: api.fetch, days: 3 });
    expect(outlook.days.map((d) => d.date)).toEqual(FROM_4_NOV.slice(0, 3));
    // The third evening is read at 16:35 UTC on 6 Nov, 68.4 hours away. Interpolating needs the
    // 17:00 value, hour 69 counted from 20:00, the current hour: 70 hours, plus one spare.
    expect(new URL(api.urls[0]).searchParams.get("forecast_hours")).toBe("71");
  });

  it("reports when the weather service fails", async () => {
    const failing = (async () =>
      new Response(JSON.stringify({ error: true, reason: "Daily API request limit exceeded." }), {
        status: 429,
      })) as typeof fetch;
    await expect(getOutlook(51.5, -0.1, { fetch: failing })).rejects.toMatchObject({
      code: "weather-unavailable",
      message: expect.stringContaining("Daily API request limit exceeded"),
    });
  });
});

describe("localDate", () => {
  it("gives the date where the sunset happens", () => {
    expect(localDate(new Date("2026-11-04T16:28:00Z"), "Europe/London")).toBe("2026-11-04");
    // Honolulu is 10 h behind UTC: its 4 Nov sunset is on 5 Nov in UTC.
    expect(localDate(new Date("2026-11-05T03:50:00Z"), "Pacific/Honolulu")).toBe("2026-11-04");
    // London summer time: 23:30 UTC is already the next day.
    expect(localDate(new Date("2026-06-21T23:30:00Z"), "Europe/London")).toBe("2026-06-22");
  });

  it("falls back to UTC for a timezone it doesn't know", () => {
    expect(localDate(new Date("2026-11-05T03:50:00Z"), "Not/A_Zone")).toBe("2026-11-05");
  });
});
