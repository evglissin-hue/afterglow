"use client";

import { useEffect, useEffectEvent, useMemo, useRef, useState, type ReactNode, type SyntheticEvent } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { CAMERA_FOV, angleDiff, coverFieldOfView, placeOnScreen, type PhonePose, type Size } from "@/lib/compass";
import type { Sky } from "./Compass";
import { timeFormatter } from "./spotStyle";

/** Compass points marked along the horizon. */
const POINTS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"].map((label, i) => ({ label, bearing: i * 45 }));

type Spot = { x: number; y: number; inView: boolean };

function cameraProblem(error: unknown): string {
  const name = error instanceof Error ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") return "Camera access was refused, so here's the dial.";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "No camera found, so here's the dial.";
  if (name === "NotReadableError") return "The camera is busy in another app. Close it and try again.";
  return "Couldn't start the camera, so here's the dial.";
}

const stopStream = (stream: MediaStream) => stream.getTracks().forEach((track) => track.stop());

/** Where things go on screen: the horizon, the sunset, the sun and its path, in pixels. */
function layout(pose: PhonePose, sky: Sky, box: Size, video: Size | null) {
  const fov = coverFieldOfView(CAMERA_FOV, video ?? box, box);
  const camera = { heading: pose.cameraHeading ?? pose.heading, pitch: pose.pitch };
  const at = (bearing: number, altitude: number): Spot | null => {
    const p = placeOnScreen({ bearing, altitude }, camera, fov);
    return p && { x: p.x * box.width, y: p.y * box.height, inView: p.inView };
  };
  // Points far off screen are left out; that's where the dotted path breaks.
  const near = (p: Spot | null): p is Spot =>
    p !== null && Math.abs(p.x - box.width / 2) < 2 * box.width && Math.abs(p.y - box.height / 2) < 2 * box.height;

  const path: string[] = [];
  let run: string[] = [];
  for (const point of sky.path) {
    const p = at(point.azimuth, point.altitude);
    if (near(p)) {
      run.push(`${p.x.toFixed(1)},${p.y.toFixed(1)}`);
    } else {
      if (run.length > 1) path.push(run.join(" "));
      run = [];
    }
  }
  if (run.length > 1) path.push(run.join(" "));

  // Whole hours along the path, after now (the sun itself marks now).
  const hours = sky.path.slice(1).flatMap((point) => {
    if (point.time.getTime() % 3_600_000 !== 0) return [];
    const p = at(point.azimuth, point.altitude);
    return p?.inView ? [{ time: point.time, x: p.x, y: p.y }] : [];
  });
  const points = POINTS.flatMap(({ label, bearing }) => {
    const p = at(bearing, 0);
    return p && p.x > -40 && p.x < box.width + 40 ? [{ label, x: p.x, y: p.y }] : [];
  });

  const horizon = at(camera.heading, 0);
  const sunset = at(sky.bearing, 0);
  const offToThe =
    !sunset || sunset.x < 0 || sunset.x > box.width ? (angleDiff(camera.heading, sky.bearing) > 0 ? "right" : "left") : null;
  const hint = !horizon
    ? "Point your phone at the horizon."
    : horizon.y < 0
      ? "Raise your phone to the horizon."
      : horizon.y > box.height
        ? "Lower your phone to the horizon."
        : null;
  return { horizon, sunset, sun: sky.sun ? at(sky.sun.azimuth, sky.sun.altitude) : null, path, hours, points, offToThe, hint };
}

/**
 * The rear camera, full screen, with the horizon, tonight's sunset point and the sun's path to it drawn where they
 * are. The camera runs only while this view is open, and stops when it closes or the page is hidden.
 */
export function CameraView({
  pose,
  sky,
  guidance,
  facing,
  sunsetLine,
  timeZone,
  onClose,
  onProblem,
  children,
}: {
  pose: PhonePose;
  sky: Sky;
  guidance: string;
  facing: boolean;
  sunsetLine: string;
  timeZone: string;
  onClose: () => void;
  onProblem: (message: string) => void;
  /** Controls at the bottom, within thumb reach. */
  children?: ReactNode;
}) {
  const box = useRef<HTMLElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [videoSize, setVideoSize] = useState<Size | null>(null);
  const [boxSize, setBoxSize] = useState<Size | null>(null);
  const problem = useEffectEvent((message: string) => onProblem(message));
  const close = useEffectEvent(() => onClose());
  const format = useMemo(() => timeFormatter(timeZone), [timeZone]);

  useEffect(() => {
    if (!navigator.mediaDevices?.getUserMedia) {
      const id = setTimeout(() => problem("This browser can't open the camera here, so here's the dial."), 0);
      return () => clearTimeout(id);
    }
    let cancelled = false;
    let opened: MediaStream | null = null;
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false })
      .then((s) => {
        if (cancelled) return stopStream(s);
        opened = s;
        s.getVideoTracks()[0]?.addEventListener("ended", () => {
          if (!cancelled) problem("The camera stopped, so here's the dial.");
        });
        setStream(s);
      })
      .catch((error: unknown) => {
        if (!cancelled) problem(cameraProblem(error));
      });
    return () => {
      cancelled = true;
      if (opened) stopStream(opened);
    };
  }, []);

  useEffect(() => {
    const el = video.current;
    if (!el || !stream) return;
    el.srcObject = stream;
    el.play().catch(() => undefined);
    return () => {
      el.srcObject = null;
    };
  }, [stream]);

  // Leaving the app or the page closes the camera.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden") close();
    };
    const onPageHide = () => close();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, []);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.focus();
    const observer = new ResizeObserver(([entry]) =>
      setBoxSize({ width: entry.contentRect.width, height: entry.contentRect.height }),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const readVideoSize = (event: SyntheticEvent<HTMLVideoElement>) => {
    const { videoWidth: width, videoHeight: height } = event.currentTarget;
    if (width > 0 && height > 0) setVideoSize({ width, height });
  };

  const scene = boxSize && boxSize.width > 0 && boxSize.height > 0 ? layout(pose, sky, boxSize, videoSize) : null;

  return (
    <section
      ref={box}
      tabIndex={-1}
      aria-label="Camera view"
      className="fixed inset-0 z-50 overflow-hidden bg-black text-white outline-none"
    >
      <video
        ref={video}
        autoPlay
        muted
        playsInline
        aria-hidden="true"
        onLoadedMetadata={readVideoSize}
        onResize={readVideoSize}
        className="absolute inset-0 size-full object-cover"
      />
      {!stream && <p className="absolute inset-x-0 top-1/3 text-center text-white/70">Starting the camera…</p>}

      {scene && boxSize && (
        <svg
          className="absolute inset-0 size-full"
          viewBox={`0 0 ${boxSize.width} ${boxSize.height}`}
          aria-hidden="true"
        >
          <defs>
            <radialGradient id="camera-sunset-glow">
              <stop offset="0" stopColor="#ffc35c" stopOpacity="0.9" />
              <stop offset="0.4" stopColor="#f08a3c" stopOpacity="0.4" />
              <stop offset="1" stopColor="#f08a3c" stopOpacity="0" />
            </radialGradient>
            <radialGradient id="camera-sun-glow">
              <stop offset="0" stopColor="#fff1c9" stopOpacity="0.8" />
              <stop offset="1" stopColor="#fff1c9" stopOpacity="0" />
            </radialGradient>
          </defs>
          {/* Turned with the phone, so the drawn horizon matches the real one. */}
          <g transform={`rotate(${pose.roll.toFixed(2)} ${boxSize.width / 2} ${boxSize.height / 2})`}>
            {scene.horizon && (
              <g>
                <line
                  x1={-boxSize.width}
                  x2={2 * boxSize.width}
                  y1={scene.horizon.y}
                  y2={scene.horizon.y}
                  stroke="rgba(0,0,0,0.35)"
                  strokeWidth="4"
                />
                <line
                  x1={-boxSize.width}
                  x2={2 * boxSize.width}
                  y1={scene.horizon.y}
                  y2={scene.horizon.y}
                  stroke="rgba(255,255,255,0.85)"
                  strokeWidth="1.5"
                />
              </g>
            )}
            {scene.points.map((p) => (
              <g key={p.label}>
                <line x1={p.x} x2={p.x} y1={p.y - 7} y2={p.y + 7} stroke="rgba(255,255,255,0.85)" strokeWidth="1.5" />
                <text
                  x={p.x}
                  y={p.y - 14}
                  textAnchor="middle"
                  fontSize="13"
                  fontWeight="600"
                  fill="#fff"
                  stroke="rgba(0,0,0,0.5)"
                  strokeWidth="3"
                  paintOrder="stroke"
                >
                  {p.label}
                </text>
              </g>
            ))}
            {scene.path.map((points) => (
              <polyline
                key={points}
                points={points}
                fill="none"
                stroke="#ffc35c"
                strokeWidth="4"
                strokeDasharray="0.1 11"
                strokeLinecap="round"
              />
            ))}
            {scene.hours.map((h) => (
              <g key={h.time.getTime()}>
                <circle cx={h.x} cy={h.y} r="4" fill="#ffc35c" stroke="rgba(0,0,0,0.4)" />
                <text
                  x={h.x + 9}
                  y={h.y - 8}
                  fontSize="12"
                  fill="#fff"
                  stroke="rgba(0,0,0,0.5)"
                  strokeWidth="3"
                  paintOrder="stroke"
                >
                  {format(h.time)}
                </text>
              </g>
            ))}
            {scene.sun?.inView && (
              <g>
                <circle cx={scene.sun.x} cy={scene.sun.y} r="24" fill="url(#camera-sun-glow)" />
                <circle cx={scene.sun.x} cy={scene.sun.y} r="8" fill="#fff1c9" />
                <text
                  x={scene.sun.x}
                  y={scene.sun.y + 26}
                  textAnchor="middle"
                  fontSize="12"
                  fill="#fff"
                  stroke="rgba(0,0,0,0.5)"
                  strokeWidth="3"
                  paintOrder="stroke"
                >
                  Sun now
                </text>
              </g>
            )}
            {scene.sunset && (
              <g>
                <circle
                  cx={scene.sunset.x}
                  cy={scene.sunset.y}
                  r={facing ? 54 : 40}
                  fill="url(#camera-sunset-glow)"
                  className={facing ? "motion-safe:animate-pulse" : undefined}
                />
                <circle cx={scene.sunset.x} cy={scene.sunset.y} r="12" fill="#ffc35c" stroke="#0d0b14" strokeWidth="2" />
                <text
                  x={scene.sunset.x}
                  y={scene.sunset.y + 34}
                  textAnchor="middle"
                  fontSize="14"
                  fontWeight="600"
                  fill="#fff"
                  stroke="rgba(0,0,0,0.55)"
                  strokeWidth="3"
                  paintOrder="stroke"
                >
                  Sunset {format(sky.sunset)}
                </text>
              </g>
            )}
          </g>
        </svg>
      )}

      {scene?.offToThe && boxSize && (
        <p
          className={`absolute flex -translate-y-1/2 items-center gap-1.5 rounded-full bg-black/55 px-3 py-2 text-sm font-semibold backdrop-blur-md ${
            scene.offToThe === "right" ? "right-3" : "left-3"
          }`}
          style={{
            top: Math.min(Math.max(scene.horizon?.y ?? boxSize.height / 2, boxSize.height * 0.2), boxSize.height * 0.6),
          }}
        >
          {scene.offToThe === "left" && <ChevronLeft className="size-5" aria-hidden="true" />}
          <span className="size-2.5 rounded-full bg-[#ffc35c] shadow-[0_0_8px_2px_rgba(255,195,92,0.7)]" aria-hidden="true" />
          Sunset
          {scene.offToThe === "right" && <ChevronRight className="size-5" aria-hidden="true" />}
        </p>
      )}

      <p className="absolute inset-x-0 top-[max(0.75rem,env(safe-area-inset-top))] mx-auto w-fit max-w-[calc(100%-2rem)] rounded-full bg-black/45 px-3 py-1.5 text-center text-xs text-white/85 backdrop-blur-md">
        Phone compasses can be 10–20° off in a city.
      </p>

      <div className="absolute inset-x-0 bottom-0 bg-linear-to-t from-black/85 via-black/55 to-transparent px-4 pt-24 pb-[max(1rem,env(safe-area-inset-bottom))] [@media(max-height:500px)]:pt-4">
        <div className="mx-auto max-w-md text-center">
          <div className="[text-shadow:0_1px_6px_rgba(0,0,0,0.6)]">
            {scene?.hint && <p className="mb-2 text-[15px] font-medium">{scene.hint}</p>}
            <p
              className={`text-[2rem] leading-tight font-semibold tracking-tight [@media(max-height:500px)]:text-2xl ${
                facing ? "text-ember" : "text-white"
              }`}
            >
              {guidance}
            </p>
            <p className="mt-1 text-sm text-white/80 [@media(max-height:500px)]:hidden">{sunsetLine}</p>
          </div>
          <div className="mt-4 [@media(max-height:500px)]:mt-2">{children}</div>
        </div>
      </div>
    </section>
  );
}
