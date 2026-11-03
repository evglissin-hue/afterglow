import { getPosition } from "suncalc";
import { distanceKm, type LatLon } from "@/lib/geo";
import { sunEvents } from "@/lib/sun";

export type SpotKind = "park" | "water" | "bridge" | "street" | "viewpoint" | "rooftop";

/** A spot as written by pipeline/build_spots.py. */
export interface Spot {
  id: string;
  name: string;
  kind: SpotKind;
  lat: number;
  lon: number;
  /** 0–100: how often through the year the sunset is in view, plus how much western sky is open. */
  score: number;
  /** Obstacle angle per bearing, in tenths of a degree (see ProfileSpec). */
  h: number[];
  /** For streets: the direction you look down the street. */
  sb?: number;
  access?: "dusk" | "hours";
  hours?: string;
  /** Eye height above the ground when higher than standing (bridges, rooftops), m. */
  eye?: number;
}

export interface ProfileSpec {
  from: number;
  step: number;
  count: number;
}

export interface SpotIndex {
  version: number;
  generated: string;
  profile: ProfileSpec;
  tile: { lat: number; lon: number };
  tiles: Record<string, number>;
}

export const DEFAULT_PROFILE: ProfileSpec = { from: 220, step: 2, count: 51 };

/** How a spot's view toward the sunset looks, by obstacle angle (SPEC.md §6.3). */
export type View = "open" | "low" | "sky" | "blocked";

export const VIEWS: Record<View, { label: string; text: string }> = {
  open: { label: "Open horizon", text: "The sun sets in view" },
  low: { label: "Low skyline", text: "The sun disappears a few minutes early" },
  sky: { label: "Sky view", text: "The sun hides early, but you see the colors" },
  blocked: { label: "Blocked", text: "Not a good spot tonight" },
};

export const KIND_LABELS: Record<SpotKind, string> = {
  park: "Park",
  water: "Waterside",
  bridge: "Bridge",
  street: "Street",
  viewpoint: "Viewpoint",
  rooftop: "Rooftop",
};

export function viewFor(angle: number): View {
  if (angle < 2) return "open";
  if (angle < 5) return "low";
  if (angle < 12) return "sky";
  return "blocked";
}

/** Obstacle angle (degrees) toward a bearing, or null outside the profile's range. */
export function obstacleAt(spot: Spot, bearing: number, profile: ProfileSpec = DEFAULT_PROFILE): number | null {
  const position = (bearing - profile.from) / profile.step;
  if (position < 0 || position > profile.count - 1) return null;
  const lo = Math.floor(position);
  const hi = Math.min(lo + 1, profile.count - 1);
  const w = position - lo;
  return (spot.h[lo] * (1 - w) + spot.h[hi] * w) / 10;
}

/**
 * When the sun finally drops behind whatever is in the way, or null if it sets in view.
 * Walks back from sunset minute by minute to the last moment the sun clears the obstacles, so a
 * tall building it passes behind earlier in the afternoon doesn't count.
 */
export function sunHidesAt(spot: Spot, sunset: Date, profile: ProfileSpec = DEFAULT_PROFILE): Date | null {
  const minute = 60_000;
  const lookBack = 150;
  const sunRadiusDeg = 0.27; // the sun is visible while its top edge clears the obstacle
  for (let m = 0; m <= lookBack; m++) {
    const t = sunset.getTime() - m * minute;
    const sun = getPosition(new Date(t), spot.lat, spot.lon);
    const obstacle = obstacleAt(spot, sun.azimuth, profile);
    if (obstacle === null || sun.altitude + sunRadiusDeg > obstacle) {
      return m <= 3 ? null : new Date(t + minute);
    }
  }
  return new Date(sunset.getTime() - lookBack * minute);
}

/** Tonight's view in the sunset direction, e.g. for a map pin or list row. */
export function viewTonight(spot: Spot, sunsetBearing: number, profile: ProfileSpec = DEFAULT_PROFILE) {
  const angle = obstacleAt(spot, sunsetBearing, profile);
  return { angle, view: angle === null ? null : viewFor(angle) };
}

/** The view on the 15th of each month (index 0 = January). */
export function viewByMonth(spot: Spot, year: number, profile: ProfileSpec = DEFAULT_PROFILE): (View | null)[] {
  return Array.from({ length: 12 }, (_, month) => {
    const events = sunEvents(new Date(Date.UTC(year, month, 15, 12)), spot.lat, spot.lon);
    const angle = events ? obstacleAt(spot, events.bearing, profile) : null;
    return angle === null ? null : viewFor(angle);
  });
}

/** For a street: the days of `year` when the sun sets straight down it (within 0.75°). */
export function hengeDays(spot: Spot, year: number): Date[] {
  if (spot.sb === undefined) return [];
  const days: { day: Date; off: number }[] = [];
  for (let d = 0; d < 365; d++) {
    const day = new Date(Date.UTC(year, 0, 1 + d, 12));
    const events = sunEvents(day, spot.lat, spot.lon);
    if (events) days.push({ day, off: Math.abs(events.bearing - spot.sb) });
  }
  // The sunset passes each bearing twice a year: once heading north (spring), once south (autumn).
  const halves = [days.filter(({ day }) => day.getUTCMonth() < 6), days.filter(({ day }) => day.getUTCMonth() >= 6)];
  return halves
    .map((half) => half.reduce((best, next) => (next.off < best.off ? next : best), half[0]))
    .filter((best) => best && best.off <= 0.75)
    .map((best) => best.day);
}

/** Walking time estimate: straight line × 1.3 for the street network, at 5 km/h. */
export function walkMinutes(from: LatLon, spot: LatLon): number {
  return Math.round(((distanceKm(from, spot) * 1.3) / 5) * 60);
}

/** Leave in time to arrive 10 minutes before sunset. */
export function leaveBy(sunset: Date, walk: number): Date {
  return new Date(sunset.getTime() - (10 + walk) * 60_000);
}

export interface RankedSpot {
  spot: Spot;
  walk: number;
  angle: number | null;
  view: View | null;
}

const VIEW_ORDER: Record<View, number> = { open: 0, low: 1, sky: 2, blocked: 3 };

/**
 * Whether to show a spot tonight. A street only looks down a narrow corridor, so it's only worth
 * showing on the evenings the sun sets (nearly) straight down it.
 */
export function showTonight(spot: Spot, view: View | null): boolean {
  return spot.kind !== "street" || view === "open" || view === "low";
}

/** Spots within `maxWalk` minutes, best view toward tonight's sunset first, then the closest. */
export function rankSpots(
  spots: Spot[],
  from: LatLon,
  sunsetBearing: number,
  maxWalk: number,
  profile: ProfileSpec = DEFAULT_PROFILE,
): RankedSpot[] {
  return spots
    .map((spot) => ({ spot, walk: walkMinutes(from, spot), ...viewTonight(spot, sunsetBearing, profile) }))
    .filter((r) => r.walk <= maxWalk && showTonight(r.spot, r.view))
    .sort(
      (a, b) =>
        (a.view ? VIEW_ORDER[a.view] : 4) - (b.view ? VIEW_ORDER[b.view] : 4) ||
        a.walk - b.walk ||
        b.spot.score - a.spot.score,
    );
}

export function tileKey(lat: number, lon: number, tile: SpotIndex["tile"]): string {
  return `${Math.floor(lat / tile.lat)}_${Math.floor(lon / tile.lon)}`;
}

/** Keys of the tiles that exist within `radiusKm` of a point. */
export function tilesAround(center: LatLon, radiusKm: number, index: SpotIndex): string[] {
  const dLat = radiusKm / 111.32;
  const dLon = radiusKm / (111.32 * Math.cos((center.lat * Math.PI) / 180));
  const keys: string[] = [];
  for (let i = Math.floor((center.lat - dLat) / index.tile.lat); i <= Math.floor((center.lat + dLat) / index.tile.lat); i++) {
    for (let j = Math.floor((center.lon - dLon) / index.tile.lon); j <= Math.floor((center.lon + dLon) / index.tile.lon); j++) {
      const key = `${i}_${j}`;
      if (index.tiles[key]) keys.push(key);
    }
  }
  return keys;
}

/** Load the spot index and the tiles around a point. */
export async function loadSpotsNear(
  center: LatLon,
  radiusKm: number,
  options: { baseUrl?: string; fetch?: typeof fetch } = {},
): Promise<{ index: SpotIndex; spots: Spot[] }> {
  const base = options.baseUrl ?? "/data/spots";
  const doFetch = options.fetch ?? fetch;
  const index = (await (await doFetch(`${base}/index.json`)).json()) as SpotIndex;
  const tiles = await Promise.all(
    tilesAround(center, radiusKm, index).map(async (key) => {
      const response = await doFetch(`${base}/${key}.json`);
      return ((await response.json()) as { spots: Spot[] }).spots;
    }),
  );
  return { index, spots: tiles.flat() };
}
