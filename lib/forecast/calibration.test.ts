import { describe, expect, it } from "vitest";
import { ratingFor, rescore, review, snapshotOf, targetScore, type RatedEvening } from "./calibration";
import { config } from "./config";
import type { Forecast } from "./getForecast";
import rated from "./__fixtures__/rated-sunsets.json";

const evenings = rated.logs as RatedEvening[];

describe("ratings and scores", () => {
  it("a rating stands for the middle of its label's band", () => {
    expect([1, 2, 3, 4, 5].map((r) => targetScore(r))).toEqual([12, 35, 55, 75, 93]);
  });

  it("a score predicts the rating of its label", () => {
    expect([0, 24, 25, 44, 45, 64, 65, 84, 85, 100].map((s) => ratingFor(s))).toEqual([1, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
  });
});

describe("scoring logged evenings again", () => {
  const first = evenings[0];

  it("gives nothing without the inputs", () => {
    expect(rescore(undefined)).toBeNull();
    expect(rescore({ score: 40, label: "Fair", look: "clean" })).toBeNull();
  });

  it("matches the formula that was live when changing nothing", () => {
    const again = rescore(first.forecast);
    expect(again).not.toBeNull();
    // 16 Nov 2026 showed 11 under formula 1; formula 2 scores the same sky Fair.
    expect(first.forecast?.score).toBe(11);
    expect(again).toBeGreaterThanOrEqual(28);
    expect(again).toBeLessThanOrEqual(34);
  });

  it("responds to the settings passed in", () => {
    const generous = { ...config, glow: { base: 0.4, gapMax: 0 } } as unknown as typeof config;
    expect(rescore(first.forecast, generous)!).toBeGreaterThan(rescore(first.forecast)!);
  });

  it("keeps a forecast's inputs small and complete", () => {
    const forecast = {
      score: 50,
      label: "Good",
      look: "golden",
      lookTitle: "Golden to pink",
      confidence: "high",
      formula: config.formula,
      generatedAt: "2026-11-16T15:00:00.000Z",
      leadHours: 1.2,
      sun: { sunset: "2026-11-16T16:09:22.251Z" },
      inputs: first.forecast!.inputs!.map((i) => ({
        ...i,
        input: { ...i.input, points: i.input.points.map((p) => ({ ...p, low: p.low + 0.00004 })) },
      })),
    } as unknown as Forecast;
    const snapshot = snapshotOf(forecast);
    expect(snapshot.inputs).toHaveLength(first.forecast!.inputs!.length);
    expect(snapshot.inputs![0].input.points[0].low).toBe(first.forecast!.inputs![0].input.points[0].low);
    expect(JSON.stringify(snapshot).length).toBeLessThan(6000);
  });
});

describe("the rated evenings on file", () => {
  it("are scored no worse than when this was last tuned", () => {
    const result = review(evenings);
    expect(result.count).toBe(evenings.length);
    // Raise these only with a reason: they are the error the current settings leave on real evenings.
    expect(result.meanAbsError).toBeLessThanOrEqual(25);
    expect(Math.abs(result.bias)).toBeLessThanOrEqual(25);
  });

  it("the new formula beats the old score on them", () => {
    const { rows } = review(evenings);
    const before = rows.reduce((s, r) => s + Math.abs(r.then - r.target), 0);
    const after = rows.reduce((s, r) => s + Math.abs(r.error), 0);
    expect(after).toBeLessThan(before);
  });
});
