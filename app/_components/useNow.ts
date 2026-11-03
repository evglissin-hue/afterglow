"use client";

import { useEffect, useState } from "react";

/** The current time, refreshed every 30 s. Null until mounted, so nothing time-based renders on the server. */
export function useNow(everyMs = 30_000): Date | null {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const tick = () => setNow(new Date());
    const first = setTimeout(tick, 0);
    const every = setInterval(tick, everyMs);
    return () => {
      clearTimeout(first);
      clearInterval(every);
    };
  }, [everyMs]);
  return now;
}
