import { config } from "@/lib/forecast/config";
import type { Label } from "@/lib/forecast/score";

/** Scores a subscriber can ask to hear about (SPEC.md §3, US6). */
export const ALERT_LABELS = ["Good", "Great", "Epic"] as const;
export type AlertLabel = (typeof ALERT_LABELS)[number];

/** How long before sunset the alert is decided. */
export const LEAD_MINUTES = [60, 120, 180] as const;
export type LeadMinutes = (typeof LEAD_MINUTES)[number];

export interface AlertSettings {
  /** Alert when the score reaches at least this label. */
  minLabel: AlertLabel;
  leadMinutes: LeadMinutes;
  /** Also send "It's happening" just before sunset. */
  happeningNow: boolean;
  /** Send once if a "no" decision later clears the bar. */
  upgrades: boolean;
}

export const DEFAULT_ALERT_SETTINGS: AlertSettings = {
  minLabel: "Great",
  leadMinutes: 120,
  happeningNow: true,
  upgrades: true,
};

/** A saved spot, as the app keeps it in localStorage (`afterglow:favorites`). */
export interface Favorite {
  id: string;
  /** Spot tile key, e.g. "1029_-1". */
  tile: string;
  name: string;
}

export const MAX_FAVORITES = 50;

/** The lowest score that earns `label`, read from the forecast's own label table. */
export function minScoreFor(label: Label): number {
  const entry = config.labels.find(([, name]) => name === label);
  if (!entry) throw new Error(`Unknown label: ${label}`);
  return entry[0];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Settings from untrusted input (a request body or saved JSON), or null if anything is off. */
export function parseAlertSettings(value: unknown): AlertSettings | null {
  if (!isRecord(value)) return null;
  const { minLabel, leadMinutes, happeningNow, upgrades } = value;
  if (!(ALERT_LABELS as readonly unknown[]).includes(minLabel)) return null;
  if (!(LEAD_MINUTES as readonly unknown[]).includes(leadMinutes)) return null;
  if (typeof happeningNow !== "boolean" || typeof upgrades !== "boolean") return null;
  return { minLabel: minLabel as AlertLabel, leadMinutes: leadMinutes as LeadMinutes, happeningNow, upgrades };
}

const FAVORITE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const TILE_KEY = /^-?\d{1,6}_-?\d{1,6}$/;

/** One favorite from untrusted input, keeping only the fields alerts use. */
export function parseFavorite(value: unknown): Favorite | null {
  if (!isRecord(value)) return null;
  const { id, tile, name } = value;
  if (typeof id !== "string" || !FAVORITE_ID.test(id)) return null;
  if (typeof tile !== "string" || !TILE_KEY.test(tile)) return null;
  if (typeof name !== "string") return null;
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 200) return null;
  return { id, tile, name: trimmed };
}

/** A whole favorites list, or null if it isn't a list, is too long or has a bad entry. */
export function parseFavorites(value: unknown): Favorite[] | null {
  if (!Array.isArray(value) || value.length > MAX_FAVORITES) return null;
  const favorites = value.map(parseFavorite);
  return favorites.every((f): f is Favorite => f !== null) ? favorites : null;
}

/** The usable part of a favorites list read from storage: bad entries and repeats dropped. */
export function cleanFavorites(value: unknown): Favorite[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const favorites: Favorite[] = [];
  for (const item of value) {
    const favorite = parseFavorite(item);
    if (!favorite || seen.has(favorite.id)) continue;
    seen.add(favorite.id);
    favorites.push(favorite);
    if (favorites.length === MAX_FAVORITES) break;
  }
  return favorites;
}

/** Whether `timeZone` is an IANA time zone this runtime knows, e.g. "Europe/London". */
export function isTimeZone(timeZone: unknown): timeZone is string {
  if (typeof timeZone !== "string" || !timeZone || timeZone.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone });
    return true;
  } catch {
    return false;
  }
}
