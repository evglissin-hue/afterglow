/**
 * Math for the compass and camera views: angles, the phone's pose from its motion sensors, and where a
 * direction in the sky shows on a camera image. Plain TypeScript without browser APIs, so a React Native
 * app can reuse it (SPEC.md §7.1). Angles are in degrees; bearings run clockwise from north.
 */
import { compassPoint } from "@/lib/geo";

/** Within this many degrees of the sunset bearing, you're facing it. */
export const FACING_TOLERANCE = 5;
/** Once you face it, you keep facing it until this many degrees further off, so a jittery compass doesn't flicker. */
export const FACING_HYSTERESIS = 3;
/**
 * Field of view across the long side of a phone's main rear camera image (a ~26 mm-equivalent lens).
 * Less of it shows on screen where the image is cropped to fill the screen (see coverFieldOfView).
 */
export const CAMERA_FOV = 65;

const toRad = (deg: number) => (deg * Math.PI) / 180;
const toDeg = (rad: number) => (rad * 180) / Math.PI;
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

type Vec3 = [number, number, number];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Compass bearing of a horizontal direction given as east and north components. */
const bearingOf = (east: number, north: number) => normalizeDegrees(toDeg(Math.atan2(east, north)));

/** The rear camera needs to point at least this far from straight down (or up) to have a compass heading. */
const MIN_CAMERA_LEVEL = Math.sin(toRad(15));

/** An angle as 0 ≤ a < 360. */
export function normalizeDegrees(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/** The turn from `from` to `to`: positive is clockwise (turn right), negative counterclockwise; −180 < turn ≤ 180. */
export function angleDiff(from: number, to: number): number {
  const d = normalizeDegrees(to - from);
  return d > 180 ? d - 360 : d;
}

/** Mean of angles on the circle, so 350° and 10° average to 0°, not 180°. Null when there are none or they cancel out. */
export function circularMean(angles: readonly number[]): number | null {
  let x = 0;
  let y = 0;
  for (const angle of angles) {
    x += Math.cos(toRad(angle));
    y += Math.sin(toRad(angle));
  }
  if (Math.hypot(x, y) < 1e-9 * Math.max(1, angles.length)) return null;
  return normalizeDegrees(toDeg(Math.atan2(y, x)));
}

/**
 * Smooths a jittery stream of angles, such as a compass heading, with the circular mean of the readings
 * from the last `windowMs` milliseconds. Returns a function that takes each reading and its time in ms.
 */
export function createAngleSmoother(windowMs: number): (angle: number, timeMs: number) => number {
  let readings: { angle: number; time: number }[] = [];
  return (angle, timeMs) => {
    readings = readings.filter((r) => r.time > timeMs - windowMs && r.time <= timeMs);
    readings.push({ angle, time: timeMs });
    return circularMean(readings.map((r) => r.angle)) ?? normalizeDegrees(angle);
  };
}

const POINT_WORDS: Record<string, string> = {
  N: "north",
  NNE: "north-northeast",
  NE: "northeast",
  ENE: "east-northeast",
  E: "east",
  ESE: "east-southeast",
  SE: "southeast",
  SSE: "south-southeast",
  S: "south",
  SSW: "south-southwest",
  SW: "southwest",
  WSW: "west-southwest",
  W: "west",
  WNW: "west-northwest",
  NW: "northwest",
  NNW: "north-northwest",
};

/** A bearing in words, e.g. 246 → "west-southwest". */
export const compassWords = (bearing: number) => POINT_WORDS[compassPoint(bearing)];

export type Turn = { direction: "left" | "right" | "ahead"; degrees: number };

/**
 * Which way to turn from `heading` to face `target`, in whole degrees. Within ±5° you're facing it ("ahead").
 * Pass `wasFacing` from the last reading: once facing, you stay facing until 3° further off.
 */
export function turnToward(heading: number, target: number, wasFacing = false): Turn {
  const diff = angleDiff(heading, target);
  const degrees = Math.round(Math.abs(diff));
  const limit = FACING_TOLERANCE + (wasFacing ? FACING_HYSTERESIS : 0);
  if (degrees <= limit) return { direction: "ahead", degrees };
  return { direction: diff > 0 ? "right" : "left", degrees };
}

/** Where the phone points, from its motion sensors. */
export interface PhonePose {
  /**
   * The compass heading you're facing: where the top of the screen points with the phone held flat,
   * where the rear camera looks with it upright, and a blend of the two in between.
   */
  heading: number;
  /** Compass heading the rear camera looks along; null when it points nearly straight down or up. */
  cameraHeading: number | null;
  /** How far the rear camera looks above (+) or below (−) the horizon. */
  pitch: number;
  /** How far the horizon is turned on screen, clockwise. */
  roll: number;
}

/**
 * Tilt from the gravity-based angles beta and gamma (W3C DeviceOrientation), with the screen turned
 * `screenAngle` degrees from its natural orientation (`screen.orientation.angle`).
 */
function tilt(beta: number, gamma: number, screenAngle: number) {
  const b = toRad(beta);
  const g = toRad(gamma);
  const s = toRad(screenAngle);
  // How far each of the device's axes points up: right edge, top edge, out of the screen.
  const rightUp = -Math.cos(b) * Math.sin(g);
  const topUp = Math.sin(b);
  const outUp = Math.cos(b) * Math.cos(g);
  // "Up" as it shows on screen, along the screen's top and right edges (which turn with it in landscape).
  const alongTop = Math.sin(s) * rightUp + Math.cos(s) * topUp;
  const alongRight = Math.cos(s) * rightUp - Math.sin(s) * topUp;
  return { pitch: toDeg(Math.asin(clamp(-outUp, -1, 1))), roll: toDeg(Math.atan2(alongRight, alongTop)) };
}

/**
 * The pose from absolute DeviceOrientation angles (Android's `deviceorientationabsolute`; W3C convention:
 * alpha turns about the vertical, counterclockwise from north, beta tips the top up, gamma tips sideways).
 *
 * Held flat, this is the familiar heading = 360 − alpha (plus the screen angle). It uses the full rotation
 * rather than alpha alone because near upright, the way the phone is held for the camera, alpha and gamma
 * swap meaning (gimbal lock): a small roll can swing alpha by 90° while the camera still faces the same way.
 */
export function poseFromOrientation(alpha: number, beta: number, gamma: number, screenAngle = 0): PhonePose | null {
  const a = toRad(alpha);
  const b = toRad(beta);
  const g = toRad(gamma);
  const s = toRad(screenAngle);
  const [cA, sA, cB, sB, cG, sG] = [Math.cos(a), Math.sin(a), Math.cos(b), Math.sin(b), Math.cos(g), Math.sin(g)];

  // The device's axes in east, north, up coordinates: the rotation Rz(alpha)·Rx(beta)·Ry(gamma).
  const right: Vec3 = [cA * cG - sA * sB * sG, cG * sA + cA * sB * sG, -cB * sG];
  const top: Vec3 = [-cB * sA, cA * cB, sB];
  const rear: Vec3 = [-(cA * sG + cG * sA * sB), -(sA * sG - cA * cG * sB), -cB * cG];
  // The top of the screen as you see it; in landscape that's a side of the phone.
  const screenTop = right.map((v, i) => Math.sin(s) * v + Math.cos(s) * top[i]) as Vec3;

  // Each direction counts by how level it is. The screen's top counts while the screen faces the sky
  // (it flips to the bottom edge once the screen tips past upright); the rear camera once it faces outward.
  const screenUp = -rear[2];
  const rearLevel = Math.hypot(rear[0], rear[1]);
  const east = screenUp * screenTop[0] + rearLevel * rear[0];
  const north = screenUp * screenTop[1] + rearLevel * rear[1];
  if (Math.hypot(east, north) < 1e-6) return null;

  return {
    heading: bearingOf(east, north),
    cameraHeading: rearLevel >= MIN_CAMERA_LEVEL ? bearingOf(rear[0], rear[1]) : null,
    ...tilt(beta, gamma, screenAngle),
  };
}

/**
 * The pose from iOS's `webkitCompassHeading` (where the top of the phone points; iOS corrects it for tilt)
 * and the tilt angles beta and gamma, with the screen turned `screenAngle` degrees.
 */
export function poseFromCompassHeading(compassHeading: number, beta: number, gamma: number, screenAngle = 0): PhonePose {
  const heading = normalizeDegrees(compassHeading + screenAngle);
  const { pitch, roll } = tilt(beta, gamma, screenAngle);
  return { heading, cameraHeading: Math.cos(toRad(pitch)) >= MIN_CAMERA_LEVEL ? heading : null, pitch, roll };
}

/** Angular size of what a camera image shows, degrees. */
export interface FieldOfView {
  horizontal: number;
  vertical: number;
}

export interface Size {
  width: number;
  height: number;
}

/**
 * What shows on screen of a camera image that's scaled to fill the screen and cropped (CSS `object-fit: cover`),
 * given the camera's field of view across the long side of its image.
 */
export function coverFieldOfView(longSideFov: number, image: Size, screen: Size): FieldOfView {
  if (!(screen.width > 0 && screen.height > 0)) return { horizontal: longSideFov, vertical: longSideFov };
  const source = image.width > 0 && image.height > 0 ? image : screen;
  // Focal length in image pixels, and how much the image is scaled up to cover the screen.
  const focal = Math.max(source.width, source.height) / 2 / Math.tan(toRad(longSideFov) / 2);
  const scale = Math.max(screen.width / source.width, screen.height / source.height);
  const across = (screenPx: number) => toDeg(2 * Math.atan(screenPx / scale / 2 / focal));
  return { horizontal: across(screen.width), vertical: across(screen.height) };
}

/** A point on screen as fractions: x from 0 at the left edge to 1 at the right, y from 0 at the top to 1 at the bottom. */
export interface ScreenPoint {
  x: number;
  y: number;
  /** Inside the screen (x and y between 0 and 1). */
  inView: boolean;
}

/**
 * Where a direction in the sky (compass bearing, altitude above the horizon) shows on a camera image, for a camera
 * facing `heading` and tilted `pitch` degrees above level, without roll. A pinhole camera, so the horizon is a
 * straight line. x and y run past 0–1 for points off screen; null when the point is behind the camera.
 */
export function placeOnScreen(
  target: { bearing: number; altitude: number },
  camera: { heading: number; pitch: number },
  fov: FieldOfView,
): ScreenPoint | null {
  const b = toRad(target.bearing);
  const a = toRad(target.altitude);
  const h = toRad(camera.heading);
  const p = toRad(camera.pitch);
  const direction: Vec3 = [Math.cos(a) * Math.sin(b), Math.cos(a) * Math.cos(b), Math.sin(a)];
  const forward: Vec3 = [Math.cos(p) * Math.sin(h), Math.cos(p) * Math.cos(h), Math.sin(p)];
  const right: Vec3 = [Math.cos(h), -Math.sin(h), 0];
  const up: Vec3 = [-Math.sin(p) * Math.sin(h), -Math.sin(p) * Math.cos(h), Math.cos(p)];

  const depth = dot(direction, forward);
  if (depth < 1e-6) return null;
  const x = 0.5 + dot(direction, right) / depth / (2 * Math.tan(toRad(fov.horizontal) / 2));
  const y = 0.5 - dot(direction, up) / depth / (2 * Math.tan(toRad(fov.vertical) / 2));
  return { x, y, inView: x >= 0 && x <= 1 && y >= 0 && y <= 1 };
}
