import { readFile } from "node:fs/promises";
import path from "node:path";
import type { LatLon } from "@/lib/geo";
import { tilesAround, type Spot, type SpotIndex } from "@/lib/spots";

export type SpotsNear = (center: LatLon, radiusKm: number) => Promise<{ index: SpotIndex; spots: Spot[] }>;

/**
 * Spot tiles read from public/data/spots on the server's disk. next.config.ts ships these files
 * with the alert job (outputFileTracingIncludes). Parsed tiles are kept for the life of the server.
 */
export function fileSpots(dir = path.join(process.cwd(), "public", "data", "spots")): SpotsNear {
  let index: Promise<SpotIndex> | null = null;
  const tiles = new Map<string, Promise<Spot[]>>();

  async function readJson<T>(name: string): Promise<T> {
    return JSON.parse(await readFile(path.join(dir, name), "utf8")) as T;
  }

  function tile(key: string): Promise<Spot[]> {
    let spots = tiles.get(key);
    if (!spots) {
      spots = readJson<{ spots: Spot[] }>(`${key}.json`).then(
        (data) => data.spots,
        (error: unknown) => {
          tiles.delete(key);
          throw error;
        },
      );
      tiles.set(key, spots);
    }
    return spots;
  }

  return async (center, radiusKm) => {
    index ??= readJson<SpotIndex>("index.json").catch((error: unknown) => {
      index = null;
      throw error;
    });
    const loaded = await index;
    // Keys come from the index (integers like "1029_-1"), never from a request.
    const keys = tilesAround(center, radiusKm, loaded);
    return { index: loaded, spots: (await Promise.all(keys.map(tile))).flat() };
  };
}
