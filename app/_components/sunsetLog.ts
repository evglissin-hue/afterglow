/**
 * Sunsets you've logged, kept on this phone in IndexedDB (logs and their photos). Shaped like the
 * future server tables (SPEC §8: logs, photos), so they can be uploaded once accounts exist.
 */

import { config } from "@/lib/forecast/config";
import type { ArchiveKind, ArchivedForecast } from "@/lib/forecast/archive";
import type { ForecastSnapshot } from "@/lib/forecast/calibration";

export type ViewAnswer = "yes" | "partly" | "blocked";

export interface SunsetLog {
  id: string;
  /** The evening, YYYY-MM-DD in London. One log per evening. */
  date: string;
  /** When it was logged. */
  at: string;
  rating: number;
  colors: string[];
  view?: ViewAnswer;
  spot?: { id: string; tile: string; name: string };
  note?: string;
  /** Where, rounded to about 1 km. */
  lat?: number;
  lon?: number;
  /** The forecast for that evening with what it was scored from, to see how it did and to tune the score. */
  forecast?: ForecastSnapshot;
  photoIds: string[];
}

export interface StoredPhoto {
  id: string;
  logId: string;
  full: Blob;
  thumb: Blob;
  width: number;
  height: number;
}

export const COLOR_TAGS = ["Gold", "Orange", "Red", "Pink", "Purple", "Grey"] as const;
const DB = "afterglow";
const LEGACY_RATINGS = "afterglow:my-sunsets";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("logs")) db.createObjectStore("logs", { keyPath: "id" }).createIndex("date", "date", { unique: true });
      if (!db.objectStoreNames.contains("photos")) db.createObjectStore("photos", { keyPath: "id" }).createIndex("logId", "logId");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function run<T>(stores: string[], mode: IDBTransactionMode, work: (tx: IDBTransaction) => IDBRequest<T> | void): Promise<T | undefined> {
  return open().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(stores, mode);
        const request = work(tx);
        tx.oncomplete = () => resolve(request ? request.result : undefined);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      }),
  );
}

export const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

/** The evening a sunset belongs to, as YYYY-MM-DD in London. */
export const eveningOf = (sunset: Date | string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date(sunset));

export async function listLogs(): Promise<SunsetLog[]> {
  await importLegacyRatings();
  const logs = (await run<SunsetLog[]>(["logs"], "readonly", (tx) => tx.objectStore("logs").getAll())) ?? [];
  return logs.sort((a, b) => b.date.localeCompare(a.date));
}

export async function logFor(date: string): Promise<SunsetLog | undefined> {
  return run<SunsetLog>(["logs"], "readonly", (tx) => tx.objectStore("logs").index("date").get(date));
}

/** Saves a log, replacing any earlier one for the same evening (and its photos, if they changed). */
export async function saveLog(log: SunsetLog, photos: StoredPhoto[] = []): Promise<void> {
  const earlier = await logFor(log.date);
  await run(["logs", "photos"], "readwrite", (tx) => {
    const logStore = tx.objectStore("logs");
    const photoStore = tx.objectStore("photos");
    if (earlier && earlier.id !== log.id) logStore.delete(earlier.id);
    for (const id of earlier?.photoIds ?? []) if (!log.photoIds.includes(id)) photoStore.delete(id);
    for (const photo of photos) photoStore.put({ ...photo, logId: log.id });
    logStore.put(log);
  });
}

export async function deleteLog(log: SunsetLog): Promise<void> {
  await run(["logs", "photos"], "readwrite", (tx) => {
    tx.objectStore("logs").delete(log.id);
    for (const id of log.photoIds) tx.objectStore("photos").delete(id);
  });
}

/** Marks a photo made in the photo screen that hasn't joined a log yet. */
const PENDING = "pending";

/**
 * Keeps a photo for the log screen to pick up (`/log?photo=<id>`). Only the newest waits: an
 * earlier one that never made it into a log is dropped.
 */
export async function keepPendingPhoto(photo: StoredPhoto): Promise<void> {
  await run(["photos"], "readwrite", (tx) => {
    const store = tx.objectStore("photos");
    const waiting = store.index("logId").openCursor(IDBKeyRange.only(PENDING));
    waiting.onsuccess = () => {
      const cursor = waiting.result;
      if (!cursor) return;
      if (cursor.primaryKey !== photo.id) cursor.delete();
      cursor.continue();
    };
    tx.objectStore("photos").put({ ...photo, logId: PENDING });
  });
}

export async function getPhoto(id: string): Promise<StoredPhoto | undefined> {
  return run<StoredPhoto>(["photos"], "readonly", (tx) => tx.objectStore("photos").get(id));
}

/**
 * Every log without its photos, as a file to send on: the ratings and the forecasts they were given
 * against are what the score is tuned from (SPEC.md §5.7). Places are already rounded to about 1 km.
 */
export async function exportLogs(): Promise<File> {
  const logs = (await listLogs()).map(({ photoIds, ...log }) => ({ ...log, photos: photoIds.length }));
  const archive = await archiveFor(logs).catch(() => []);
  const withArchive = logs.map((log) => {
    const rows = archive.filter((row) => row.evening === log.date);
    const snapshotOf = (kind: ArchiveKind) => rows.find((row) => row.kind === kind)?.snapshot;
    return rows.length ? { ...log, archive: { before: snapshotOf("before"), after: snapshotOf("after") } } : log;
  });
  const body = JSON.stringify({ app: "afterglow", exportedAt: new Date().toISOString(), formula: config.formula, logs: withArchive }, null, 1);
  return new File([body], `afterglow-sunsets-${eveningOf(new Date())}.json`, { type: "application/json" });
}

/** The server's archived forecasts for the logged evenings (SPEC.md §5.7), when it has them and there's a signal. */
async function archiveFor(logs: { date: string; lat?: number; lon?: number }[]): Promise<ArchivedForecast[]> {
  const placed = logs.filter((log) => log.lat != null && log.lon != null);
  if (!placed.length) return [];
  const oldest = placed.reduce((a, b) => (a.date < b.date ? a : b));
  const days = Math.min(365, Math.ceil((Date.now() - Date.parse(`${oldest.date}T12:00:00Z`)) / 86_400_000) + 1);
  // Logs are a walk from home: the cell of the newest one stands for all of them.
  const response = await fetch(`/api/archive?lat=${placed[0].lat}&lon=${placed[0].lon}&days=${days}`);
  if (!response.ok) return [];
  return ((await response.json()) as { rows: ArchivedForecast[] }).rows;
}

/** Quick ratings from live mode (kept in localStorage before logs existed) become logs. */
async function importLegacyRatings() {
  let legacy: { date: string; rating: number; at: string; lat: number; lon: number; forecast: SunsetLog["forecast"] }[] = [];
  try {
    legacy = JSON.parse(localStorage.getItem(LEGACY_RATINGS) ?? "[]");
  } catch {
    return;
  }
  if (!legacy.length) return;
  for (const r of legacy) {
    if (await logFor(r.date)) continue;
    await saveLog({ id: newId(), date: r.date, at: r.at, rating: r.rating, colors: [], lat: r.lat, lon: r.lon, forecast: r.forecast, photoIds: [] });
  }
  localStorage.removeItem(LEGACY_RATINGS);
}

/**
 * Shrinks a photo on the phone: at most 2048 px plus a 400 px thumbnail. Re-encoding drops all
 * metadata, including where it was taken (SPEC §9).
 */
export async function preparePhoto(file: File): Promise<StoredPhoto> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const encode = async (max: number, quality: number) => {
    const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", quality));
    return { blob: blob ?? (await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), "image/jpeg", quality))), canvas };
  };
  const full = await encode(2048, 0.85);
  const thumb = await encode(400, 0.8);
  bitmap.close();
  return { id: newId(), logId: "", full: full.blob, thumb: thumb.blob, width: full.canvas.width, height: full.canvas.height };
}
