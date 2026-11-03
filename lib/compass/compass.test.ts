import { describe, expect, it } from "vitest";
import {
  angleDiff,
  circularMean,
  compassWords,
  coverFieldOfView,
  createAngleSmoother,
  normalizeDegrees,
  placeOnScreen,
  poseFromCompassHeading,
  poseFromOrientation,
  turnToward,
} from ".";

/** Two bearings agree, counting 359.9999° and 0° as the same. */
function expectBearing(actual: number | null | undefined, expected: number, within = 1e-6) {
  expect(actual).toBeTypeOf("number");
  expect(Math.abs(angleDiff(actual as number, expected))).toBeLessThan(within);
}

describe("angles", () => {
  it("normalizes to 0–360", () => {
    expect(normalizeDegrees(-10)).toBe(350);
    expect(normalizeDegrees(370)).toBe(10);
    expect(normalizeDegrees(360)).toBe(0);
    expect(normalizeDegrees(-720)).toBe(0);
    expect(Object.is(normalizeDegrees(-0), 0)).toBe(true);
  });

  it("gives the signed turn, across north too", () => {
    expect(angleDiff(211, 246)).toBeCloseTo(35);
    expect(angleDiff(256, 246)).toBeCloseTo(-10);
    expect(angleDiff(350, 10)).toBeCloseTo(20);
    expect(angleDiff(10, 350)).toBeCloseTo(-20);
    expect(angleDiff(0, 180)).toBe(180);
    expect(angleDiff(180, 0)).toBe(180);
    expect(angleDiff(720, -30)).toBeCloseTo(-30);
  });

  it("averages on the circle", () => {
    expectBearing(circularMean([350, 10]), 0);
    expectBearing(circularMean([355, 5, 15]), 5);
    expectBearing(circularMean([10, 20, 30]), 20);
    expectBearing(circularMean([359, 1, 0, 358, 2]), 0);
    expect(circularMean([])).toBeNull();
    expect(circularMean([0, 180])).toBeNull();
    expect(circularMean([90, 270])).toBeNull();
  });

  it("names compass points in words", () => {
    expect(compassWords(246)).toBe("west-southwest");
    expect(compassWords(0)).toBe("north");
    expect(compassWords(135)).toBe("southeast");
    expect(compassWords(359)).toBe("north");
  });
});

describe("smoothing a jittery compass", () => {
  it("averages recent readings across north", () => {
    const smooth = createAngleSmoother(250);
    expectBearing(smooth(358, 0), 358);
    expectBearing(smooth(2, 16), 0);
    expectBearing(smooth(0, 32), 0);
  });

  it("forgets readings older than the window", () => {
    const smooth = createAngleSmoother(250);
    smooth(10, 0);
    smooth(20, 100);
    expectBearing(smooth(90, 1000), 90);
  });

  it("damps jitter", () => {
    const smooth = createAngleSmoother(250);
    let last = 0;
    for (let i = 0; i < 30; i++) last = smooth(i % 2 ? 4 : 356, i * 16);
    expect(Math.abs(angleDiff(last, 0))).toBeLessThan(0.5);
  });
});

describe("which way to turn", () => {
  it("turns right or left the short way", () => {
    expect(turnToward(211, 246)).toEqual({ direction: "right", degrees: 35 });
    expect(turnToward(256, 246)).toEqual({ direction: "left", degrees: 10 });
    expect(turnToward(350, 10)).toEqual({ direction: "right", degrees: 20 });
    expect(turnToward(10, 350)).toEqual({ direction: "left", degrees: 20 });
    expect(turnToward(66, 246).degrees).toBe(180);
  });

  it("counts within ±5° as facing it", () => {
    expect(turnToward(246, 246)).toEqual({ direction: "ahead", degrees: 0 });
    expect(turnToward(241, 246).direction).toBe("ahead");
    expect(turnToward(251, 246).direction).toBe("ahead");
    expect(turnToward(240.6, 246).direction).toBe("ahead"); // rounds to 5°
    expect(turnToward(240.4, 246)).toEqual({ direction: "right", degrees: 6 });
    expect(turnToward(2, 358).direction).toBe("ahead");
  });

  it("keeps facing it a little longer, so jitter at the edge doesn't flicker", () => {
    expect(turnToward(239, 246, false)).toEqual({ direction: "right", degrees: 7 });
    expect(turnToward(239, 246, true).direction).toBe("ahead");
    expect(turnToward(237, 246, true)).toEqual({ direction: "right", degrees: 9 });
  });
});

type V = [number, number, number];
const rad = (deg: number) => (deg * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;
const add = (a: V, b: V, ka = 1, kb = 1): V => [ka * a[0] + kb * b[0], ka * a[1] + kb * b[1], ka * a[2] + kb * b[2]];

/** The W3C rotation Rz(alpha)·Rx(beta)·Ry(gamma) as the device's right, top and out-of-screen axes (east, north, up). */
function axesFromEuler(alpha: number, beta: number, gamma: number): [V, V, V] {
  const [cA, sA, cB, sB, cG, sG] = [alpha, alpha, beta, beta, gamma, gamma].map((v, i) =>
    i % 2 ? Math.sin(rad(v)) : Math.cos(rad(v)),
  );
  return [
    [cA * cG - sA * sB * sG, cG * sA + cA * sB * sG, -cB * sG],
    [-cB * sA, cA * cB, sB],
    [cA * sG + cG * sA * sB, sA * sG - cA * cG * sB, cB * cG],
  ];
}

/** Euler angles in the W3C ranges (alpha 0–360, beta −180–180, gamma −90–90) for device axes, as a browser reports them. */
function eulerFromAxes([x, y, z]: [V, V, V]) {
  // Matrix entries R[row][column]; the columns are the device axes.
  const r = (row: number, col: number) => [x, y, z][col][row];
  let alpha: number, beta: number, gamma: number;
  if (Math.abs(r(2, 2)) > 1e-12) {
    const up = r(2, 2) > 0;
    alpha = up ? Math.atan2(-r(0, 1), r(1, 1)) : Math.atan2(r(0, 1), -r(1, 1));
    beta = up ? Math.asin(r(2, 1)) : -Math.asin(r(2, 1)) + (r(2, 1) >= 0 ? Math.PI : -Math.PI);
    gamma = up ? Math.atan2(-r(2, 0), r(2, 2)) : Math.atan2(r(2, 0), -r(2, 2));
  } else if (Math.abs(r(2, 0)) > 1e-12) {
    // Screen exactly vertical, phone on its side: gamma is −90°.
    gamma = -Math.PI / 2;
    const s = Math.sign(r(2, 0));
    alpha = Math.atan2(-s * r(0, 1), s * r(1, 1));
    beta = s > 0 ? Math.asin(r(2, 1)) : -Math.asin(r(2, 1)) + (r(2, 1) >= 0 ? Math.PI : -Math.PI);
  } else {
    // Exactly upright (gimbal lock): any split between alpha and gamma works; browsers pick one.
    gamma = 0;
    beta = Math.asin(Math.max(-1, Math.min(1, r(2, 1))));
    alpha = Math.atan2(r(1, 0), r(0, 0));
  }
  return { alpha: normalizeDegrees(deg(alpha)), beta: deg(beta), gamma: deg(gamma) };
}

/**
 * Device axes for a phone whose rear camera faces `heading`, tilted `pitch` above level, with the horizon turned
 * `roll` clockwise on a screen that's turned `screenAngle` from portrait.
 */
function axesForCamera(heading: number, pitch: number, roll: number, screenAngle = 0): [V, V, V] {
  const [h, p, r, s] = [heading, pitch, roll, screenAngle].map(rad);
  const forward: V = [Math.cos(p) * Math.sin(h), Math.cos(p) * Math.cos(h), Math.sin(p)];
  const levelRight: V = [Math.cos(h), -Math.sin(h), 0];
  const levelUp: V = [-Math.sin(p) * Math.sin(h), -Math.sin(p) * Math.cos(h), Math.cos(p)];
  // The screen's right and top edges as you see them, turned so the horizon shows `roll` clockwise.
  const screenRight = add(levelRight, levelUp, Math.cos(r), Math.sin(r));
  const screenTop = add(levelRight, levelUp, -Math.sin(r), Math.cos(r));
  // Back to the device's own axes, which the screen angle turns against.
  const right = add(screenTop, screenRight, Math.sin(s), Math.cos(s));
  const top = add(screenTop, screenRight, Math.cos(s), -Math.sin(s));
  return [right, top, [-forward[0], -forward[1], -forward[2]]];
}

describe("phone pose from DeviceOrientation", () => {
  it("decomposes test rotations the way browsers do (helper check)", () => {
    for (const [a, b, g] of [
      [30, 40, 10],
      [200, 100, -80],
      [300, -20, 45],
      [90, 170, 5],
    ]) {
      const axes = axesFromEuler(a, b, g);
      const back = axesFromEuler(...(Object.values(eulerFromAxes(axes)) as V));
      axes.forEach((axis, i) => axis.forEach((v, j) => expect(back[i][j]).toBeCloseTo(v, 9)));
    }
  });

  it("reads 360 − alpha when the phone is flat or tipped toward you", () => {
    for (const alpha of [0, 45, 90, 200, 300]) {
      for (const beta of [0, 40, 75]) {
        expectBearing(poseFromOrientation(alpha, beta, 0)?.heading, 360 - alpha);
      }
    }
    const flat = poseFromOrientation(90, 0, 0)!;
    expect(flat.cameraHeading).toBeNull(); // the camera looks at the floor
    expect(flat.pitch).toBeCloseTo(-90);
  });

  it("reads where the camera looks when the phone is upright", () => {
    const upright = poseFromOrientation(114, 90, 0)!;
    expectBearing(upright.heading, 246);
    expectBearing(upright.cameraHeading, 246);
    expect(upright.pitch).toBeCloseTo(0);
    expect(upright.roll).toBeCloseTo(0);
  });

  it("doesn't care how gimbal lock splits a turn between alpha and gamma", () => {
    const viaGamma = poseFromOrientation(0, 90, 30)!;
    const viaAlpha = poseFromOrientation(30, 90, 0)!;
    expectBearing(viaGamma.cameraHeading, 330);
    expectBearing(viaAlpha.cameraHeading, 330);
    expectBearing(viaGamma.heading, 330);
  });

  it("isn't fooled when a small roll swings alpha by 90°", () => {
    // Upright, facing north, rolled 10° clockwise: browsers report alpha 90, which alone would say west.
    const pose = poseFromOrientation(90, 100, -90)!;
    expectBearing(pose.cameraHeading, 0);
    expectBearing(pose.heading, 0, 1e-3);
    expect(pose.pitch).toBeCloseTo(0);
    expect(pose.roll).toBeCloseTo(-10);
  });

  it("recovers heading, pitch and roll from any way of holding the phone", () => {
    for (const screenAngle of [0, 90, 180, 270]) {
      for (const heading of [0, 45, 135, 246, 300, 359]) {
        for (const pitch of [-60, -20, -3, 0, 4, 25]) {
          for (const roll of [-25, -4, 0, 6, 30]) {
            const { alpha, beta, gamma } = eulerFromAxes(axesForCamera(heading, pitch, roll, screenAngle));
            const pose = poseFromOrientation(alpha, beta, gamma, screenAngle)!;
            expectBearing(pose.cameraHeading, heading, 1e-6);
            expect(pose.pitch).toBeCloseTo(pitch, 6);
            expect(angleDiff(pose.roll, roll)).toBeCloseTo(0, 6);
            if (roll === 0) expectBearing(pose.heading, heading, 1e-6);
          }
        }
      }
    }
  });

  it("follows the screen in landscape", () => {
    // Flat, top of the phone toward the west: in landscape the screen's top is the phone's right edge, north.
    expectBearing(poseFromOrientation(90, 0, 0, 90)?.heading, 0);
    expectBearing(poseFromOrientation(90, 0, 0, 270)?.heading, 180);
    expectBearing(poseFromOrientation(90, 0, 0, 0)?.heading, 270);
  });

  it("uses iOS's compass heading as is, plus the screen angle", () => {
    const upright = poseFromCompassHeading(246, 90, 0);
    expect(upright.heading).toBe(246);
    expect(upright.cameraHeading).toBe(246);
    expect(upright.pitch).toBeCloseTo(0, 9);
    expect(upright.roll).toBeCloseTo(0, 9);
    expectBearing(poseFromCompassHeading(300, 0, 0, 90).heading, 30);
    expect(poseFromCompassHeading(100, 0, 0).cameraHeading).toBeNull();
    expect(poseFromCompassHeading(100, 110, 0).pitch).toBeCloseTo(20);
    expect(poseFromCompassHeading(100, 70, 0).pitch).toBeCloseTo(-20);
  });
});

describe("placing the sky on a camera image", () => {
  const fov = { horizontal: 60, vertical: 90 };
  const level = (heading: number) => ({ heading, pitch: 0 });
  const xFor = (offDeg: number) => 0.5 + Math.tan(rad(offDeg)) / (2 * Math.tan(rad(30)));

  it("puts what you face in the middle", () => {
    expect(placeOnScreen({ bearing: 246, altitude: 0 }, level(246), fov)).toEqual({ x: 0.5, y: 0.5, inView: true });
  });

  it("puts things to the right on the right, and to the left on the left", () => {
    const right = placeOnScreen({ bearing: 266, altitude: 0 }, level(246), fov)!;
    expect(right.x).toBeCloseTo(xFor(20), 9);
    expect(right.y).toBeCloseTo(0.5, 9);
    expect(right.inView).toBe(true);
    expect(placeOnScreen({ bearing: 226, altitude: 0 }, level(246), fov)!.x).toBeCloseTo(xFor(-20), 9);
  });

  it("wraps around north", () => {
    expect(placeOnScreen({ bearing: 10, altitude: 0 }, level(350), fov)!.x).toBeCloseTo(xFor(20), 9);
    expect(placeOnScreen({ bearing: 350, altitude: 0 }, level(10), fov)!.x).toBeCloseTo(xFor(-20), 9);
    expect(placeOnScreen({ bearing: 0, altitude: 0 }, level(359.5), fov)!.x).toBeCloseTo(xFor(0.5), 9);
  });

  it("knows what's off screen or behind you", () => {
    expect(placeOnScreen({ bearing: 276, altitude: 0 }, level(246), fov)!.inView).toBe(true); // right on the edge
    const off = placeOnScreen({ bearing: 286, altitude: 0 }, level(246), fov)!;
    expect(off.inView).toBe(false);
    expect(off.x).toBeGreaterThan(1);
    expect(placeOnScreen({ bearing: 206, altitude: 0 }, level(246), fov)!.x).toBeLessThan(0);
    expect(placeOnScreen({ bearing: 66, altitude: 0 }, level(246), fov)).toBeNull();
    expect(placeOnScreen({ bearing: 336, altitude: 0 }, level(246), fov)).toBeNull(); // 90° off
    const high = placeOnScreen({ bearing: 246, altitude: 60 }, level(246), fov)!;
    expect(high.y).toBeLessThan(0);
    expect(high.inView).toBe(false);
  });

  it("moves the horizon down as you tip the phone up, and keeps it level", () => {
    const up = { heading: 246, pitch: 10 };
    const horizon = placeOnScreen({ bearing: 246, altitude: 0 }, up, fov)!;
    expect(horizon.y).toBeCloseTo(0.5 + Math.tan(rad(10)) / 2, 9);
    expect(placeOnScreen({ bearing: 266, altitude: 0 }, up, fov)!.y).toBeCloseTo(horizon.y, 9);
    expect(placeOnScreen({ bearing: 226, altitude: 0 }, up, fov)!.y).toBeCloseTo(horizon.y, 9);
    expect(placeOnScreen({ bearing: 246, altitude: 10 }, up, fov)).toEqual({ x: 0.5, y: 0.5, inView: true });
    const down = placeOnScreen({ bearing: 246, altitude: 0 }, { heading: 246, pitch: -10 }, fov)!;
    expect(down.y).toBeCloseTo(0.5 - Math.tan(rad(10)) / 2, 9);
    expect(placeOnScreen({ bearing: 246, altitude: 0 }, { heading: 246, pitch: -60 }, fov)!.y).toBeLessThan(0);
  });
});

describe("field of view on screen", () => {
  it("shows the whole image when it has the screen's shape", () => {
    const wide = coverFieldOfView(65, { width: 1280, height: 720 }, { width: 640, height: 360 });
    expect(wide.horizontal).toBeCloseTo(65, 9);
    expect(wide.vertical).toBeCloseTo(deg(2 * Math.atan(Math.tan(rad(32.5)) * (720 / 1280))), 9);
    const tall = coverFieldOfView(65, { width: 720, height: 1280 }, { width: 720, height: 1280 });
    expect(tall.vertical).toBeCloseTo(65, 9);
    expect(tall.horizontal).toBeCloseTo(wide.vertical, 9);
  });

  it("narrows where the image is cropped to fill a taller phone screen", () => {
    const phone = coverFieldOfView(65, { width: 720, height: 1280 }, { width: 390, height: 844 });
    expect(phone.vertical).toBeCloseTo(65, 6);
    expect(phone.horizontal).toBeCloseTo(32.8, 1);
  });

  it("falls back to the screen's shape before the camera reports its size", () => {
    const unknown = coverFieldOfView(65, { width: 0, height: 0 }, { width: 390, height: 844 });
    expect(unknown.vertical).toBeCloseTo(65, 6);
    expect(coverFieldOfView(65, { width: 0, height: 0 }, { width: 0, height: 0 })).toEqual({
      horizontal: 65,
      vertical: 65,
    });
  });
});
