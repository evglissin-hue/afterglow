import { readFile } from "node:fs/promises";
import path from "node:path";
import type { LatLon } from "@/lib/geo";
import { tilesAround, type Spot, type SpotIndex } from "@/lib/spots";

export type SpotsNear = (center: LatLon, radiusKm: number) => Promise<{ index: SpotIndex; spots: Spot[] }>;

// A path the build can see is inside public/data/spots, so only those files ship with the
// alert job (next.config.ts lists them too, with outputFileTracingIncludes).
const readSpotFile = async <T>(name: string): Promise<T> =>
  JSON.parse(await readFile(path.join(process.cwd(), "public", "data", "spots", name), "utf8")) as T;

/** Spot tiles read from public/data/spots on the server's disk, kept in memory once parsed. */
export function fileSpots(): SpotsNear {
  let index: Promise<SpotIndex> | null = null;
  const tiles = new Map<string, Promise<Spot[]>>();

  function tile(key: string): Promise<Spot[]> {
    let spots = tiles.get(key);
    if (!spots) {
      spots = readSpotFile<{ spots: Spot[] }>(`${key}.json`).then(
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
    index ??= readSpotFile<SpotIndex>("index.json").catch((error: unknown) => {
      index = null;
      throw error;
    });
    const loaded = await index;
    // Keys come from the index (integers like "1029_-1"), never from a request.
    const keys = tilesAround(center, radiusKm, loaded);
    return { index: loaded, spots: (await Promise.all(keys.map(tile))).flat() };
  };
}
