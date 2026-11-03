"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  angleDiff,
  createAngleSmoother,
  poseFromCompassHeading,
  poseFromOrientation,
  type PhonePose,
} from "@/lib/compass";

export type CompassStatus =
  /** Listening, no reading yet. */
  | "starting"
  /** iPhone and iPad: waiting for a tap on "Start compass". */
  | "needs-permission"
  | "live"
  | "denied"
  /** No compass on this device, or the browser doesn't share it. */
  | "unavailable";

/** iOS adds the compass heading to orientation events. */
type CompassEvent = DeviceOrientationEvent & { webkitCompassHeading?: number | null };
type OrientationEventClass = typeof DeviceOrientationEvent & {
  requestPermission?: () => Promise<"granted" | "denied" | "default">;
};

/** No reading this long after starting means there's no compass. */
const NO_COMPASS_AFTER_MS = 2500;
/**
 * iPhone sends no orientation events at all until the visitor allows them. Silence this long, where the browser
 * can ask, means it's waiting for a tap. (Chrome can ask too, but sends events, or one empty event, right away.)
 */
const ASK_AFTER_MS = 800;
/** Readings are averaged over this long: steady, without lagging behind a turn. */
const SMOOTHING_MS = 250;
/** Smaller changes than this don't redraw anything. */
const MIN_CHANGE_DEG = 0.1;

const orientationEvents = () =>
  typeof window === "undefined" ? undefined : (window.DeviceOrientationEvent as OrientationEventClass | undefined);

/** The screen's rotation from the phone's natural orientation, degrees. */
function screenAngle(): number {
  const angle = screen.orientation?.angle ?? (window as { orientation?: number }).orientation ?? 0;
  return ((angle % 360) + 360) % 360;
}

const moved = (a: number | null, b: number | null) =>
  a === null || b === null ? a !== b : Math.abs(angleDiff(a, b)) >= MIN_CHANGE_DEG;

function changed(before: PhonePose | null, after: PhonePose): boolean {
  return (
    !before ||
    moved(before.heading, after.heading) ||
    moved(before.cameraHeading, after.cameraHeading) ||
    moved(before.pitch, after.pitch) ||
    moved(before.roll, after.roll)
  );
}

/**
 * The phone's compass heading and tilt, smoothed. Android Chrome reports them as `deviceorientationabsolute`
 * events; iPhone reports `webkitCompassHeading` once the visitor allows it with a tap (`start`).
 */
export function useHeading() {
  const [status, setStatus] = useState<CompassStatus>("starting");
  const [pose, setPose] = useState<PhonePose | null>(null);
  const listen = useRef<() => void>(() => undefined);

  useEffect(() => {
    const Orientation = orientationEvents();
    if (!Orientation) {
      const id = setTimeout(() => setStatus("unavailable"), 0);
      return () => clearTimeout(id);
    }

    const smooth = {
      heading: createAngleSmoother(SMOOTHING_MS),
      camera: createAngleSmoother(SMOOTHING_MS),
      pitch: createAngleSmoother(SMOOTHING_MS),
      roll: createAngleSmoother(SMOOTHING_MS),
    };
    let latest: PhonePose | null = null;
    let shown: PhonePose | null = null;
    let frame = 0;
    let anyEvent = false;
    let absoluteEvents = false;

    // Draw at most once a frame, however fast the sensor fires.
    const draw = () => {
      frame = 0;
      if (latest && changed(shown, latest)) {
        shown = latest;
        setPose(latest);
      }
      setStatus("live");
    };
    const take = (raw: PhonePose | null, time: number) => {
      if (!raw) return;
      latest = {
        heading: smooth.heading(raw.heading, time),
        cameraHeading: raw.cameraHeading === null ? null : smooth.camera(raw.cameraHeading, time),
        pitch: angleDiff(0, smooth.pitch(raw.pitch, time)),
        roll: angleDiff(0, smooth.roll(raw.roll, time)),
      };
      if (!frame) frame = requestAnimationFrame(draw);
    };
    const fromAngles = (event: DeviceOrientationEvent) => {
      const { alpha, beta, gamma } = event;
      if (alpha === null || beta === null || gamma === null) return;
      take(poseFromOrientation(alpha, beta, gamma, screenAngle()), event.timeStamp);
    };
    // Android Chrome: angles relative to north.
    const onAbsolute = (event: Event) => {
      anyEvent = true;
      absoluteEvents = true;
      fromAngles(event as DeviceOrientationEvent);
    };
    // iPhone: a compass heading on the ordinary event. Elsewhere these angles are only relative, unless marked absolute.
    const onOrientation = (event: Event) => {
      anyEvent = true;
      const e = event as CompassEvent;
      const compass = e.webkitCompassHeading;
      if (typeof compass === "number" && Number.isFinite(compass)) {
        take(poseFromCompassHeading(compass, e.beta ?? 90, e.gamma ?? 0, screenAngle()), e.timeStamp);
      } else if (e.absolute && !absoluteEvents) {
        fromAngles(e);
      }
    };

    const stop = () => {
      window.removeEventListener("deviceorientationabsolute", onAbsolute);
      window.removeEventListener("deviceorientation", onOrientation);
    };
    listen.current = () => {
      stop();
      if ("ondeviceorientationabsolute" in window) window.addEventListener("deviceorientationabsolute", onAbsolute);
      window.addEventListener("deviceorientation", onOrientation);
    };
    listen.current();

    // iPhone asks first, and only after a tap; if it was allowed earlier, readings simply arrive.
    const canAsk = typeof Orientation.requestPermission === "function" && navigator.maxTouchPoints > 0;
    const id = canAsk
      ? setTimeout(() => {
          if (!anyEvent) setStatus((s) => (s === "starting" ? "needs-permission" : s));
        }, ASK_AFTER_MS)
      : undefined;

    return () => {
      clearTimeout(id);
      stop();
      cancelAnimationFrame(frame);
      listen.current = () => undefined;
    };
  }, []);

  // No reading soon after starting: no compass.
  useEffect(() => {
    if (status !== "starting") return;
    const id = setTimeout(() => setStatus((s) => (s === "starting" ? "unavailable" : s)), NO_COMPASS_AFTER_MS);
    return () => clearTimeout(id);
  }, [status]);

  /** Asks for the compass (iPhone). Call it straight from a tap. */
  const start = useCallback(async () => {
    const Orientation = orientationEvents();
    if (!Orientation?.requestPermission) return;
    try {
      const answer = await Orientation.requestPermission();
      if (answer !== "granted") {
        setStatus("denied");
        return;
      }
      listen.current();
      setStatus((s) => (s === "live" ? s : "starting"));
    } catch {
      setStatus("denied");
    }
  }, []);

  return { status, pose, start };
}
