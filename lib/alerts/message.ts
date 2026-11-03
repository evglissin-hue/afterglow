import type { LatLon } from "@/lib/geo";
import { VIEWS, leaveBy, rankSpots, tileKey, type Spot, type SpotIndex, type View } from "@/lib/spots";
import type { AlertForecast, AlertKind } from "./decide";
import type { AlertLabel, Favorite } from "./settings";

/** What the service worker (public/sw.js) shows. Tapping opens `url`. */
export interface PushMessage {
  title: string;
  body: string;
  url: string;
  /** A newer notification with the same tag replaces the older one. */
  tag: string;
}

/** The spot an alert names. */
export interface BestSpot {
  id: string;
  name: string;
  tile: string;
  walk: number;
  view: View;
  favorite: boolean;
}

/** Straight-line distance (km) a walk of `minutes` can cover, as walkMinutes() in lib/spots counts it, plus slack. */
export const walkRadiusKm = (minutes: number) => ((minutes / 60) * 5) / 1.3 + 0.2;

/**
 * The spot to name in an alert: the top of tonight's ranking within the subscriber's walk, or a
 * favorite in that ranking whose view tonight is open or a low skyline. Never a blocked view.
 */
export function bestSpotFor({
  spots,
  index,
  from,
  walkMinutes,
  bearing,
  favorites = [],
}: {
  spots: Spot[];
  index: Pick<SpotIndex, "profile" | "tile">;
  from: LatLon;
  walkMinutes: number;
  /** Tonight's sunset bearing, degrees. */
  bearing: number;
  favorites?: Favorite[];
}): BestSpot | null {
  const ranked = rankSpots(spots, from, bearing, walkMinutes, index.profile).filter(
    (r): r is typeof r & { view: View } => r.view !== null && r.view !== "blocked",
  );
  const favoriteIds = new Set(favorites.map((f) => f.id));
  const pick =
    ranked.find((r) => favoriteIds.has(r.spot.id) && (r.view === "open" || r.view === "low")) ?? ranked[0];
  if (!pick) return null;
  return {
    id: pick.spot.id,
    name: pick.spot.name,
    tile: tileKey(pick.spot.lat, pick.spot.lon, index.tile),
    walk: pick.walk,
    view: pick.view,
    favorite: favoriteIds.has(pick.spot.id),
  };
}

/** Clock times as the app shows them, e.g. "16:12", rounded to the nearest minute. */
export function timeFormatter(timeZone: string) {
  const fmt = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone });
  return (date: Date) => fmt.format(new Date(Math.round(date.getTime() / 60_000) * 60_000));
}

/**
 * The notification for an alert, e.g.
 * "Great sunset likely tonight (74)" / "Fiery orange and red. Best near you: Hilly Fields, 8 min
 * walk, open horizon. Leave by 16:12."
 */
export function alertMessage({
  kind,
  forecast,
  spot,
  timeZone,
  now,
  day,
}: {
  kind: AlertKind;
  forecast: AlertForecast;
  spot: BestSpot | null;
  timeZone: string;
  now: Date;
  /** The sunset's date, YYYY-MM-DD, so each day's notifications stay separate. */
  day: string;
}): PushMessage {
  const time = timeFormatter(timeZone);
  const sunset = new Date(forecast.sun.sunset);
  const bestEnd = new Date(forecast.sun.bestColor.end);

  if (kind === "happening-now") {
    return {
      title: "It's happening: look west",
      body: `${forecast.lookText} Best color until ${time(bestEnd)}.`,
      url: "/",
      tag: `afterglow-${day}-now`,
    };
  }

  const title =
    kind === "upgrade"
      ? `Sunset now looks ${forecast.label} (${forecast.score})`
      : `${forecast.label} sunset likely tonight (${forecast.score})`;

  let body = `${forecast.lookTitle}.`;
  if (spot) {
    const walk = Math.max(1, spot.walk);
    const leave = leaveBy(sunset, walk);
    const when = leave.getTime() - now.getTime() < 60_000 ? "Leave now." : `Leave by ${time(leave)}.`;
    body += ` Best near you: ${spot.name}, ${walk} min walk, ${VIEWS[spot.view].label.toLowerCase()}. ${when}`;
  } else {
    body += ` Sunset ${time(sunset)}, best color ${time(new Date(forecast.sun.bestColor.start))}–${time(bestEnd)}.`;
  }

  return {
    title,
    body,
    url: spot ? `/spots/${spot.tile}/${spot.id}` : "/",
    tag: `afterglow-${day}`,
  };
}

/** The notification sent by "Send a test alert". */
export function testMessage(minLabel: AlertLabel): PushMessage {
  const bar = minLabel === "Epic" ? "Epic" : `${minLabel} or better`;
  return {
    title: "Test alert from Afterglow",
    body: `Alerts are on. You'll hear from us when tonight's sunset looks ${bar}.`,
    url: "/alerts",
    tag: "afterglow-test",
  };
}
