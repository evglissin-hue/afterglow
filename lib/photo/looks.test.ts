import { describe, expect, it } from "vitest";
import { LOOKS, applyLook, lookById, prepareLook, type LookRecipe } from "./looks";

const NEUTRAL: LookRecipe = {
  exposure: 0,
  warmth: 0,
  tint: 0,
  contrast: 0,
  blacks: 0,
  vibrance: 0,
  saturation: 0,
  shadows: [0, 0, 0],
  highlights: [0, 0, 0],
};

const pixels = (...rgb: [number, number, number][]) => new Uint8ClampedArray(rgb.flatMap(([r, g, b]) => [r, g, b, 255]));
const golden = prepareLook(lookById("golden").recipe!);
const dusk = prepareLook(lookById("dusk").recipe!);

describe("the looks on offer", () => {
  it("are the original and three recipes, no more", () => {
    expect(LOOKS.map((l) => l.id)).toEqual(["original", "natural", "golden", "dusk"]);
    expect(LOOKS[0].recipe).toBeNull();
    expect(LOOKS.slice(1).every((l) => l.recipe)).toBe(true);
  });
});

describe("applyLook", () => {
  it("a neutral recipe changes nothing beyond the grain", () => {
    const before = pixels([0, 0, 0], [12, 40, 90], [128, 128, 128], [240, 180, 60], [255, 255, 255]);
    const after = new Uint8ClampedArray(before);
    applyLook(after, prepareLook(NEUTRAL));
    after.forEach((v, i) => expect(Math.abs(v - before[i])).toBeLessThanOrEqual(1));
  });

  it("leaves transparency alone", () => {
    const px = new Uint8ClampedArray([200, 120, 40, 77, 10, 20, 30, 0]);
    applyLook(px, golden);
    expect([px[3], px[7]]).toEqual([77, 0]);
  });

  it("Golden warms a pale sky and deepens it; Dusk cools it toward violet", () => {
    const sky: [number, number, number] = [205, 195, 185];
    const warm = pixels(sky);
    const cool = pixels(sky);
    applyLook(warm, golden);
    applyLook(cool, dusk);
    expect(warm[0] - warm[2]).toBeGreaterThan(sky[0] - sky[2] + 15); // more red over blue
    expect(warm[1]).toBeLessThan(sky[1]); // a little under-exposed
    expect(cool[2]).toBeGreaterThan(cool[1]); // blue over green: violet
  });

  it("keeps the sun and its halo from clipping to flat color", () => {
    const px = pixels([255, 255, 255], [255, 236, 170], [250, 215, 120]);
    applyLook(px, golden);
    // Still three distinct steps of brightness, the brightest near white and none pushed past it.
    const luma = [0, 4, 8].map((i) => 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]);
    expect(luma[0]).toBeGreaterThan(luma[1] + 4);
    expect(luma[1]).toBeGreaterThan(luma[2] + 4);
    expect(px[0]).toBeGreaterThanOrEqual(250);
  });

  it("keeps silhouettes dark", () => {
    const px = pixels([14, 12, 10]);
    applyLook(px, golden);
    expect(Math.max(px[0], px[1], px[2])).toBeLessThanOrEqual(16);
  });

  it("gives the same result in strips as in one pass", () => {
    const whole = new Uint8ClampedArray(4 * 600);
    for (let i = 0; i < whole.length; i += 4) whole.set([(i * 7) % 256, (i * 3) % 256, (i * 11) % 256, 255], i);
    const strips = new Uint8ClampedArray(whole);
    applyLook(whole, golden);
    for (let start = 0; start < 600; start += 200) applyLook(strips.subarray(start * 4, (start + 200) * 4), golden, start);
    expect(strips).toEqual(whole);
  });

  it("doesn't band a smooth sky gradient", () => {
    // 24 neighboring sky tones, 2,000 pixels of each: the long smooth gradient where 8-bit curves show steps.
    const run = 2000;
    const row = new Uint8ClampedArray(24 * run * 4);
    for (let x = 0; x < 24 * run; x++) {
      const v = 150 + Math.floor(x / run);
      row.set([v + 40, v, v - 50, 255], x * 4);
    }
    applyLook(row, golden);

    const means: number[] = [];
    let mixed = 0;
    for (let tone = 0; tone < 24; tone++) {
      let sum = 0;
      let low = 255;
      let high = 0;
      for (let x = tone * run; x < (tone + 1) * run; x++) {
        const g = row[x * 4 + 1];
        sum += g;
        low = Math.min(low, g);
        high = Math.max(high, g);
      }
      means.push(sum / run);
      expect(high - low).toBeLessThanOrEqual(1); // grain of one level at most
      if (high > low) mixed++;
    }
    // Every tone stays apart from its neighbor (none merged into a band), by an even amount, and
    // most land between two levels, which only dithering can show.
    const steps = means.slice(1).map((m, i) => m - means[i]);
    expect(Math.min(...steps)).toBeGreaterThan(0.6);
    expect(Math.max(...steps) - Math.min(...steps)).toBeLessThan(0.4);
    expect(mixed).toBeGreaterThan(12);
  });
});
