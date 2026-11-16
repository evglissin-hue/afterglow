import { describe, expect, it } from "vitest";
import { SAMPLE_KM } from "./config";
import { combineModels, labelFor, scoreSunset, type Observer, type ScoreInput } from "./score";

type Layers = { low?: number; mid?: number; high?: number };

/** Build a sky from a function of distance along the sunset line. */
function sky(layersAt: (km: number) => Layers, observer: Partial<Observer> = {}): ScoreInput {
  return {
    points: SAMPLE_KM.map((km) => ({ km, lat: 0, lon: 0, low: 0, mid: 0, high: 0, ...layersAt(km) })),
    observer: { visibilityKm: 30, humidity: 70, rainNow: 0, rainPrev6h: 0, aod: 0.1, ...observer },
  };
}

const canvasOnly = (layers: Layers) => (km: number) => (km <= 50 ? layers : {});

describe("scoreSunset scenarios", () => {
  it("clear sky: a fair clean gradient", () => {
    const r = scoreSunset(sky(() => ({})));
    expect(r.score).toBe(40);
    expect(r.label).toBe("Fair");
    expect(r.look).toBe("clean");
  });

  it("half the sky in high cloud with a clear path: epic pastel", () => {
    const r = scoreSunset(sky(() => ({ high: 0.5 })));
    expect(r.score).toBe(100);
    expect(r.label).toBe("Epic");
    expect(r.look).toBe("pastel");
    expect(r.why.map((w) => w.text)).toContain("Clear gap toward the sun");
  });

  it("mid-cloud canvas with a clear path: fiery", () => {
    const r = scoreSunset(sky(canvasOnly({ mid: 0.5 })));
    expect(r.score).toBeGreaterThanOrEqual(95);
    expect(r.look).toBe("fiery");
  });

  it("cloud bank on the light path blocks it", () => {
    const r = scoreSunset(sky((km) => (km >= 150 ? { low: 0.9 } : { high: 0.5 })));
    expect(r.score).toBeGreaterThanOrEqual(20);
    expect(r.score).toBeLessThanOrEqual(30);
    expect(r.look).toBe("blocked");
    expect(r.why.map((w) => w.text)).toContain("Cloud bank toward the sunset");
  });

  it("solid cloud overhead with a bank on the path scores as before the glow split", () => {
    const r = scoreSunset(sky((km) => (km >= 150 ? { low: 0.9 } : { mid: 1 })));
    expect(r.factors.openSky).toBe(0);
    expect(r.factors.glow).toBe(0);
    expect(r.score).toBe(Math.round(100 * r.factors.potential * r.factors.gap));
    expect(r.look).toBe("blocked");
  });

  it("open sky with a cloud bank far toward the sun keeps most of its glow", () => {
    const clear = scoreSunset(sky(() => ({})));
    const bank = scoreSunset(sky((km) => (km >= 100 ? { low: 0.95, mid: 1 } : {})));
    expect(bank.score).toBe(32);
    expect(bank.score).toBeLessThan(clear.score);
    expect(bank.label).toBe("Fair");
    expect(bank.look).toBe("clean");
    expect(bank.why.map((w) => w.text)).toContain("Cloud bank far toward the sunset may cut the glow short");
  });

  it("the evening that prompted the glow split: open sky over east London, a bank beyond 50 km", () => {
    // UK Met Office cloud for 16 Nov 2026, read at 16:07 for a 16:09 sunset. The old formula gave 11
    // ("Blocked"); the owner watched it from the river and rated it 3 of 5.
    const recorded: Record<number, Layers> = {
      [-25]: { low: 0.53, mid: 0, high: 0.21 },
      0: { low: 0.01, mid: 0, high: 0.06 },
      25: { low: 0.01, mid: 0, high: 0.13 },
      50: { low: 0.96, mid: 0.32, high: 0.32 },
      100: { low: 0.93, mid: 1, high: 0.6 },
      150: { low: 0.97, mid: 1, high: 0.86 },
      200: { low: 0.95, mid: 0.98, high: 0.44 },
      300: { low: 0.8, mid: 1, high: 0.4 },
    };
    const r = scoreSunset(sky((km) => recorded[km], { visibilityKm: 12.9, humidity: 70, aod: 0.05 }));
    expect(r.score).toBeGreaterThanOrEqual(28);
    expect(r.score).toBeLessThanOrEqual(34);
    expect(r.label).toBe("Fair");
    expect(r.look).toBe("clean");
  });

  it("low overcast is grey", () => {
    const r = scoreSunset(sky(() => ({ low: 0.95, mid: 0.3 })));
    expect(r.score).toBeLessThan(10);
    expect(r.look).toBe("grey");
  });

  it("haze mutes it", () => {
    const r = scoreSunset(sky(() => ({ high: 0.5 }), { aod: 0.6 }));
    expect(r.score).toBeGreaterThan(50);
    expect(r.score).toBeLessThan(60);
    expect(r.look).toBe("hazy");
  });

  it("rain clearing beforehand adds a bonus", () => {
    const base = scoreSunset(sky(() => ({ high: 0.2 })));
    const clearing = scoreSunset(sky(() => ({ high: 0.2 }), { rainPrev6h: 3 }));
    expect(clearing.score - base.score).toBe(8);
    expect(clearing.factors.clearing).toBe(true);
  });

  it("heavy rain at sunset is grey", () => {
    const r = scoreSunset(sky(() => ({ high: 0.5 }), { rainNow: 1.2 }));
    expect(r.look).toBe("grey");
    expect(r.score).toBe(40);
  });

  it("a poor score names what holds it back instead of promising colors", () => {
    // Cloud layers recorded for central London on 3 Nov 2026 (UK Met Office model).
    const recorded: Record<number, Layers> = {
      [-25]: { low: 0.55, mid: 0.09 },
      0: { low: 0.67, mid: 0.27 },
      25: { low: 0.81, mid: 0.62 },
      50: { low: 0.81, mid: 0.59 },
      100: { low: 0.79, mid: 0.91 },
      150: { low: 0.47, mid: 0.39 },
      200: { low: 0.37, mid: 0.43 },
      300: { low: 0.4, mid: 0.15 },
    };
    const r = scoreSunset(sky((km) => recorded[km]));
    expect(r.label).toBe("Poor");
    expect(r.look).toBe("blocked");
  });

  it("missing visibility and AOD don't penalise", () => {
    const r = scoreSunset(sky(() => ({ high: 0.5 }), { visibilityKm: null, aod: null }));
    expect(r.score).toBe(100);
  });
});

describe("labels and model agreement", () => {
  it("labels by score band", () => {
    expect(labelFor(85)).toBe("Epic");
    expect(labelFor(84)).toBe("Great");
    expect(labelFor(45)).toBe("Good");
    expect(labelFor(25)).toBe("Fair");
    expect(labelFor(24)).toBe("Poor");
  });

  const at = (score: number) => scoreSunset(sky(() => ({ high: score / 200 })));

  it("takes the median and rates agreement", () => {
    const results = [
      { model: "a", result: { ...at(100), score: 77 } },
      { model: "b", result: { ...at(100), score: 66 } },
      { model: "c", result: { ...at(100), score: 74 } },
    ];
    const c = combineModels(results, 3);
    expect(c.score).toBe(74);
    expect(c.label).toBe("Great");
    expect(c.primary.model).toBe("c");
    expect(c.spread).toBe(11);
    expect(c.confidence).toBe("high");
    expect(combineModels(results, 14).confidence).toBe("medium");
  });

  it("is unsure when models disagree or only one answers", () => {
    const results = [
      { model: "a", result: { ...at(100), score: 80 } },
      { model: "b", result: { ...at(100), score: 20 } },
      { model: "c", result: { ...at(100), score: 50 } },
    ];
    expect(combineModels(results, 3).confidence).toBe("low");
    expect(combineModels(results.slice(0, 1), 3).confidence).toBe("low");
  });

  it("is never sure days ahead, even when the models agree", () => {
    const results = [
      { model: "a", result: { ...at(100), score: 70 } },
      { model: "b", result: { ...at(100), score: 72 } },
      { model: "c", result: { ...at(100), score: 75 } },
    ];
    expect(combineModels(results, 3).confidence).toBe("high");
    expect(combineModels(results, 48).confidence).toBe("medium");
    expect(combineModels(results, 80).confidence).toBe("low");
  });
});
