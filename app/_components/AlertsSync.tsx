"use client";

import { useEffect } from "react";
import { syncAlertsQuietly } from "./alertsClient";

/**
 * Keeps the alert server's copy of this device's place, walk, favorites and settings fresh: when
 * the app opens or comes back to the front, it saves them again if anything changed (or a day
 * passed). Does nothing unless alerts are on here. Renders nothing; mount it on the Tonight screen.
 */
export function AlertsSync() {
  useEffect(() => {
    const sync = () => {
      if (document.visibilityState === "visible") syncAlertsQuietly().catch(() => undefined);
    };
    // Give the Tonight screen a moment to refresh the place first.
    const first = setTimeout(sync, 5000);
    document.addEventListener("visibilitychange", sync);
    return () => {
      clearTimeout(first);
      document.removeEventListener("visibilitychange", sync);
    };
  }, []);
  return null;
}
