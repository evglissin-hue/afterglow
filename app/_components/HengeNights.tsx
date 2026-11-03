"use client";

import Link from "next/link";
import { useMemo } from "react";
import { ChevronRight } from "lucide-react";
import { sunEvents } from "@/lib/sun";
import { tileKey, upcomingHenges, walkMinutes } from "@/lib/spots";
import { timeFormatter } from "./spotStyle";
import { walkRadiusKm, type Place } from "./usePlace";
import { useSpotsNear } from "./useSpots";

const DAYS = 30;
const WALK = 30;

/**
 * London's own Manhattanhenge, near you: the evenings in the next month when the sun sets straight
 * down a street within a 30-minute walk.
 */
export function HengeNights({ place, now }: { place: Place; now: Date | null }) {
  const loaded = useSpotsNear(place, walkRadiusKm(WALK));
  const hour = now ? Math.floor(now.getTime() / 3_600_000) : null;

  const henges = useMemo(() => {
    if (!loaded?.spots || !loaded.index || hour === null) return [];
    const from = new Date(hour * 3_600_000);
    // Only streets pointing where the sunset will be this month can line up, so check just those.
    const bearings = [0, 10, 20, DAYS].flatMap((d) => sunEvents(new Date(from.getTime() + d * 86_400_000), place.lat, place.lon)?.bearing ?? []);
    const lo = Math.min(...bearings) - 1;
    const hi = Math.max(...bearings) + 1;
    return loaded.spots
      .filter((s) => s.kind === "street" && s.sb !== undefined && s.sb >= lo && s.sb <= hi)
      .flatMap((spot) =>
        upcomingHenges(spot, from, DAYS).map((sunset) => ({
          spot,
          sunset,
          walk: walkMinutes(place, spot),
          href: `/spots/${tileKey(spot.lat, spot.lon, loaded.index!.tile)}/${spot.id}`,
        })),
      )
      .filter((h) => h.walk <= WALK)
      .sort((a, b) => a.sunset.getTime() - b.sunset.getTime() || a.walk - b.walk)
      .slice(0, 4);
  }, [loaded, hour, place]);

  if (!henges.length || !now) return null;
  const time = timeFormatter();
  const day = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "Europe/London" });
  const today = day.format(now);

  return (
    <section className="rounded-2xl border border-[#ffc35c]/30 bg-[#ffc35c]/[0.07] p-4" aria-labelledby="henge">
      <h2 id="henge" className="text-sm font-medium text-[#ffd9a0]">
        Street henge nights
      </h2>
      <p className="mt-0.5 text-xs text-mist">When the sun sets straight down a street near you.</p>
      <ul className="mt-1 divide-y divide-white/10">
        {henges.map((h) => {
          const date = day.format(h.sunset);
          return (
            <li key={`${h.spot.id}-${h.sunset.getTime()}`}>
              <Link href={h.href} className="flex items-center gap-3 py-3 hover:bg-white/[0.03]">
                <div className="min-w-0 flex-1">
                  <p className="leading-snug font-medium">{h.spot.name}</p>
                  <p className="text-xs text-mist">
                    {date === today ? <span className="font-semibold text-[#ffd9a0]">Tonight</span> : date} · {time(h.sunset)} ·{" "}
                    {h.walk} min walk
                  </p>
                </div>
                <ChevronRight className="size-4 shrink-0 text-dusk" aria-hidden="true" />
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
