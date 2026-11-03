export interface LatLon {
  lat: number;
  lon: number;
}

const EARTH_RADIUS_KM = 6371;

const toRad = (deg: number) => (deg * Math.PI) / 180;
const toDeg = (rad: number) => (rad * 180) / Math.PI;

/** The point `km` kilometres from `from` along `bearingDeg`. Negative `km` goes the opposite way. */
export function destination(from: LatLon, bearingDeg: number, km: number): LatLon {
  const bearing = toRad(km < 0 ? bearingDeg + 180 : bearingDeg);
  const d = Math.abs(km) / EARTH_RADIUS_KM;
  const lat1 = toRad(from.lat);
  const lon1 = toRad(from.lon);
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(bearing),
  );
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(bearing) * Math.sin(d) * Math.cos(lat1),
      Math.cos(d) - Math.sin(lat1) * Math.sin(lat2),
    );
  return { lat: toDeg(lat2), lon: ((toDeg(lon2) + 540) % 360) - 180 };
}

/** Great-circle distance in kilometres. */
export function distanceKm(a: LatLon, b: LatLon): number {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

const COMPASS_POINTS = [
  "N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
  "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW",
];

/** 16-point compass name for a bearing, e.g. 246 → "WSW". */
export function compassPoint(bearingDeg: number): string {
  const normalized = ((bearingDeg % 360) + 360) % 360;
  return COMPASS_POINTS[Math.round(normalized / 22.5) % 16];
}

/** Round to a grid step without floating-point fuzz, e.g. roundTo(51.53, 0.1) → 51.5. */
export function roundTo(value: number, step: number): number {
  return Number((Math.round(value / step) * step).toFixed(6));
}
