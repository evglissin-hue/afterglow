import type { Spot, ProfileSpec } from "@/lib/spots";

const W = 340;
const H = 176;
const LEFT = 28;
const RIGHT = W - 8;
const TOP = 16;
const MAX_DEG = 20;
const MIN_DEG = -2;
const BASE = 150; // y of MIN_DEG

export interface SunPoint {
  azimuth: number;
  altitude: number;
}

/**
 * What's in the way toward the sunset: obstacle angles from south-west (left) to north-west (right),
 * with tonight's sun path and the sunset direction at both solstices.
 */
export function ProfileChart({
  spot,
  profile,
  sunPath,
  sunsetBearing,
  hidesAt,
}: {
  spot: Spot;
  profile: ProfileSpec;
  sunPath: SunPoint[];
  sunsetBearing: number;
  hidesAt: SunPoint | null;
}) {
  const last = profile.from + profile.step * (profile.count - 1);
  const x = (bearing: number) => LEFT + ((bearing - profile.from) / (last - profile.from)) * (RIGHT - LEFT);
  const y = (deg: number) =>
    BASE - ((Math.min(MAX_DEG, Math.max(MIN_DEG, deg)) - MIN_DEG) / (MAX_DEG - MIN_DEG)) * (BASE - TOP);

  const skyline = spot.h.map((tenths, i) => `${x(profile.from + i * profile.step)},${y(tenths / 10)}`).join(" ");
  const silhouette = `${LEFT},${BASE} ${skyline} ${RIGHT},${BASE}`;
  const path = sunPath
    .filter((p) => p.azimuth >= profile.from && p.azimuth <= last && p.altitude <= MAX_DEG && p.altitude >= MIN_DEG)
    .map((p) => `${x(p.azimuth)},${y(p.altitude)}`)
    .join(" ");

  const marks = [
    { bearing: 232, label: "Dec" },
    { bearing: 270, label: "Mar · Sep" },
    { bearing: 311, label: "Jun" },
  ];

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full"
      role="img"
      aria-label="Buildings, trees and hills toward the sunset, with the sun's path tonight"
    >
      {[0, 10, 20].map((deg) => (
        <g key={deg}>
          <line x1={LEFT} x2={RIGHT} y1={y(deg)} y2={y(deg)} stroke="rgba(255,255,255,0.08)" />
          <text x={LEFT - 4} y={y(deg) + 3} textAnchor="end" fontSize="8" fill="#8a8194">
            {deg}°
          </text>
        </g>
      ))}
      {marks.map((m) => (
        <g key={m.label}>
          <line x1={x(m.bearing)} x2={x(m.bearing)} y1={TOP - 2} y2={BASE} stroke="rgba(255,255,255,0.1)" strokeDasharray="2 3" />
          <text x={x(m.bearing)} y={TOP - 5} textAnchor="middle" fontSize="8" fill="#8a8194">
            {m.label}
          </text>
        </g>
      ))}

      <polygon points={silhouette} fill="#2a2532" stroke="#6b6478" strokeWidth="1" strokeLinejoin="round" />

      {path && <polyline points={path} fill="none" stroke="#ffc35c" strokeWidth="1.5" strokeDasharray="1 3" strokeLinecap="round" />}
      <circle cx={x(sunsetBearing)} cy={y(-0.3)} r="5" fill="#ffc35c" stroke="#0d0b14" strokeWidth="1.5" />
      {hidesAt && (
        <circle cx={x(hidesAt.azimuth)} cy={y(hidesAt.altitude)} r="3.5" fill="none" stroke="#f08a3c" strokeWidth="1.5" />
      )}

      {[
        { bearing: 225, label: "SW" },
        { bearing: 270, label: "W" },
        { bearing: 315, label: "NW" },
      ].map((tick) => (
        <text key={tick.label} x={x(tick.bearing)} y={H - 6} textAnchor="middle" fontSize="9" fill="#b8aebf">
          {tick.label}
        </text>
      ))}
    </svg>
  );
}
