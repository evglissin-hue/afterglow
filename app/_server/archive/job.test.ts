import { describe, expect, it } from "vitest";
import { ARCHIVE_CELLS, archiveKindDue, cellKey, nearestArchiveCell } from "@/lib/forecast/archive";
import type { Forecast } from "@/lib/forecast/getForecast";
import { sunEvents } from "@/lib/sun";
import { runArchiveJob } from "./job";
import { ArchiveNotSetUpError, MemoryArchive, type ArchiveStore } from "./store";

const LONDON = ARCHIVE_CELLS[0];
const sunset = sunEvents(new Date("2026-11-16T12:00:00Z"), LONDON.lat, LONDON.lon)!.sunset;
const at = (minutes: number) => new Date(sunset.getTime() + minutes * 60_000);

const forecastFor = async (_cell: unknown, evening: Date, now: Date) =>
  ({
    score: 42,
    label: "Fair",
    look: "clean",
    lookTitle: "Clean gradient",
    confidence: "high",
    formula: 2,
    generatedAt: now.toISOString(),
    leadHours: (evening.getTime() - now.getTime()) / 3_600_000,
    sun: { sunset: evening.toISOString() },
    inputs: [],
  }) as unknown as Forecast;

describe("archive windows", () => {
  it("opens before sunset and again after it", () => {
    expect(archiveKindDue(at(-121), sunset)).toBeNull();
    expect(archiveKindDue(at(-120), sunset)).toBe("before");
    expect(archiveKindDue(at(-61), sunset)).toBe("before");
    expect(archiveKindDue(at(-60), sunset)).toBeNull();
    expect(archiveKindDue(at(0), sunset)).toBeNull();
    expect(archiveKindDue(at(60), sunset)).toBe("after");
    expect(archiveKindDue(at(239), sunset)).toBe("after");
    expect(archiveKindDue(at(240), sunset)).toBeNull();
  });

  it("names cells without a negative zero and finds the nearest", () => {
    expect(cellKey({ lat: 51.5, lon: -0 })).toBe("51.5,0.0");
    expect(cellKey(nearestArchiveCell({ lat: 51.487, lon: -0.008 }))).toBe("51.5,0.0");
    expect(cellKey(nearestArchiveCell({ lat: 51.53, lon: -0.09 }))).toBe("51.5,-0.1");
  });

  it("the sunset's own time finds the same sunset again", () => {
    expect(sunEvents(sunset, LONDON.lat, LONDON.lon)!.sunset.getTime()).toBe(sunset.getTime());
  });
});

describe("runArchiveJob", () => {
  it("does nothing outside the windows", async () => {
    const store = new MemoryArchive();
    const summary = await runArchiveJob({ store, forecastFor, now: at(-300) });
    expect(summary).toEqual({ due: 0, saved: 0, errors: [] });
  });

  it("keeps one copy before and one after for every cell, however often it runs", async () => {
    const store = new MemoryArchive();
    expect((await runArchiveJob({ store, forecastFor, now: at(-110) })).saved).toBe(ARCHIVE_CELLS.length);
    expect((await runArchiveJob({ store, forecastFor, now: at(-95) })).saved).toBe(0);
    expect((await runArchiveJob({ store, forecastFor, now: at(75) })).saved).toBe(ARCHIVE_CELLS.length);
    expect((await runArchiveJob({ store, forecastFor, now: at(90) })).saved).toBe(0);

    const rows = await store.list("51.5,-0.1", "2026-11-01");
    expect(rows.map((r) => [r.evening, r.kind])).toEqual([
      ["2026-11-16", "after"],
      ["2026-11-16", "before"],
    ]);
    expect(rows[1].snapshot.leadHours).toBeGreaterThan(1);
    expect(rows[0].snapshot.leadHours).toBeLessThan(0);
  });

  it("scores a summer sunset again after midnight", async () => {
    const june = sunEvents(new Date("2026-06-21T12:00:00Z"), LONDON.lat, LONDON.lon)!.sunset;
    const store = new MemoryArchive();
    const summary = await runArchiveJob({ store, forecastFor, now: new Date(june.getTime() + 3.9 * 3_600_000), cells: [LONDON] });
    expect(summary.saved).toBe(1);
    expect(store.rows[0]).toMatchObject({ evening: "2026-06-21", kind: "after" });
  });

  it("a failed forecast is noted and tried again next run", async () => {
    const store = new MemoryArchive();
    const failing = async () => {
      throw new Error("weather down");
    };
    const first = await runArchiveJob({ store, forecastFor: failing, now: at(-110), cells: [LONDON] });
    expect(first.saved).toBe(0);
    expect(first.errors[0]).toContain("weather down");
    expect((await runArchiveJob({ store, forecastFor, now: at(-95), cells: [LONDON] })).saved).toBe(1);
  });

  it("stops at the first cell when the table is missing", async () => {
    const store: ArchiveStore = {
      has: async () => {
        throw new ArchiveNotSetUpError();
      },
      add: async () => undefined,
      list: async () => [],
    };
    const summary = await runArchiveJob({ store, forecastFor, now: at(-110) });
    expect(summary.errors).toHaveLength(1);
    expect(summary.errors[0]).toContain("schema.sql");
  });
});
