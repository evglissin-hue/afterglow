/**
 * Sunsets you've logged, kept on this phone in IndexedDB (logs and their photos). Shaped like the
 * future server tables (SPEC §8: logs, photos), so they can be uploaded once accounts exist.
 */

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
  /** The forecast at the time, to see how it did. */
  forecast?: { score: number; label: string; look: string; lookTitle?: string; confidence?: string };
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

export async function getPhoto(id: string): Promise<StoredPhoto | undefined> {
  return run<StoredPhoto>(["photos"], "readonly", (tx) => tx.objectStore("photos").get(id));
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
