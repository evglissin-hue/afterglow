import type { View } from "@/lib/spots";

/** Pin and dot colors for each kind of view toward the sunset. */
export const VIEW_COLORS: Record<View | "unknown", string> = {
  open: "#ffc35c",
  low: "#f08a3c",
  sky: "#c77dba",
  blocked: "#5d5768",
  unknown: "#8a8194",
};

export const ACCESS_TEXT = {
  dusk: "Closes at dusk",
  hours: "Has opening hours",
} as const;

export const timeFormatter = (timeZone = "Europe/London") => {
  const fmt = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone });
  return (date: Date) => fmt.format(new Date(Math.round(date.getTime() / 60_000) * 60_000));
};
