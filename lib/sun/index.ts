import { addTime, getPosition, getTimes, times } from "suncalc";

/** Which kind of cloud will catch the light; decides when the best color happens. */
export type CloudLayer = "high" | "mid" | "clear";

export interface TimeWindow {
  start: Date;
  end: Date;
}

export interface SunEvents {
  /** Sun 6° above the horizon: golden hour starts. */
  goldenStart: Date;
  sunset: Date;
  /** Civil dusk, sun 6° below the horizon. */
  lastLight: Date;
  /** Compass bearing of the setting sun, degrees clockwise from north. */
  bearing: number;
  /** Best color window for each cloud layer (SPEC.md §5.1). */
  windows: Record<CloudLayer, TimeWindow>;
}

/** Sun altitude (degrees, sun centre) at the start and end of each best color window. */
const WINDOW_ANGLES: Record<CloudLayer, [number, number]> = {
  high: [-1.5, -3.5],
  mid: [-0.5, -2],
  clear: [-0.833, -3],
};

const SUNSET_ANGLE = -0.833;
const eveningName = (angle: number) => `afterglow${angle}`;

// Register the extra altitudes with SunCalc once, so getTimes() returns them.
for (const angle of new Set(Object.values(WINDOW_ANGLES).flat())) {
  if (angle === SUNSET_ANGLE) continue;
  if (!times.some(([, , name]) => name === eveningName(angle))) {
    addTime(angle, `${eveningName(angle)}Morning`, eveningName(angle));
  }
}

/**
 * Sunset events for the solar day containing `day`.
 * Returns null where the sun doesn't set or doesn't get low enough (polar summer).
 */
export function sunEvents(day: Date, lat: number, lon: number): SunEvents | null {
  const t = getTimes(day, lat, lon);
  const at = (angle: number): Date | null => {
    const value = angle === SUNSET_ANGLE ? t.sunset : t[eveningName(angle)];
    return value instanceof Date && !Number.isNaN(value.getTime()) ? value : null;
  };

  const sunset = at(SUNSET_ANGLE);
  const goldenStart = t.goldenHour;
  const lastLight = t.dusk;
  if (!sunset || !goldenStart || !lastLight) return null;

  const windows = {} as Record<CloudLayer, TimeWindow>;
  for (const layer of Object.keys(WINDOW_ANGLES) as CloudLayer[]) {
    const [startAngle, endAngle] = WINDOW_ANGLES[layer];
    const start = at(startAngle);
    const end = at(endAngle);
    if (!start || !end) return null;
    windows[layer] = { start, end };
  }

  const bearing = getPosition(sunset, lat, lon).azimuth;
  return { goldenStart, sunset, lastLight, bearing, windows };
}

/** The sunset to show: today's, or tomorrow's once today's last light has passed. */
export function nextSunset(now: Date, lat: number, lon: number): SunEvents | null {
  const today = sunEvents(now, lat, lon);
  if (today && now.getTime() <= today.lastLight.getTime()) return today;
  return sunEvents(new Date(now.getTime() + 24 * 60 * 60 * 1000), lat, lon);
}
