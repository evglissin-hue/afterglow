"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Camera, X } from "lucide-react";
import { distanceKm } from "@/lib/geo";
import { sunEvents } from "@/lib/sun";
import { tileKey, type Spot } from "@/lib/spots";
import { readCachedForecast } from "./forecastCache";
import {
  COLOR_TAGS,
  eveningOf,
  getPhoto,
  logFor,
  newId,
  preparePhoto,
  saveLog,
  type StoredPhoto,
  type SunsetLog,
  type ViewAnswer,
} from "./sunsetLog";
import { usePlace } from "./usePlace";
import { useSpotsNear } from "./useSpots";

const MAX_PHOTOS = 5;
const VIEW_ANSWERS: { id: ViewAnswer; label: string }[] = [
  { id: "yes", label: "Open" },
  { id: "partly", label: "Partly" },
  { id: "blocked", label: "Blocked" },
];

/** The evening being logged: today's once its sunset is near, else yesterday's. */
function eveningNow(now: Date, lat: number, lon: number): Date {
  const today = sunEvents(now, lat, lon);
  if (today && now.getTime() >= today.sunset.getTime() - 30 * 60_000) return today.sunset;
  return sunEvents(new Date(now.getTime() - 86_400_000), lat, lon)?.sunset ?? now;
}

type Draft = Omit<SunsetLog, "id" | "date" | "at" | "photoIds">;
type PhotoItem = StoredPhoto & { url: string };

/** Log tonight's sunset: a rating, colors, whether the view was open, a note and up to 5 photos. */
export function LogSunset() {
  const router = useRouter();
  const { place } = usePlace();
  const nearby = useSpotsNear(place, 0.5);
  const [evening, setEvening] = useState<Date | null>(null);
  const [existing, setExisting] = useState<SunsetLog | null>(null);
  const [draft, setDraft] = useState<Draft>({ rating: 0, colors: [] });
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [busy, setBusy] = useState<"photos" | "saving" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [spotParam, setSpotParam] = useState<{ tile: string; id: string } | null>(null);

  // Read ?rating= (from live mode) and ?spot=tile/id (from a spot page), and any log already saved tonight.
  useEffect(() => {
    if (!place) return;
    let cancelled = false;
    const params = new URLSearchParams(window.location.search);
    const [tile, id] = (params.get("spot") ?? "").split("/");
    const rating = Number(params.get("rating"));
    const sunset = eveningNow(new Date(), place.lat, place.lon);
    logFor(eveningOf(sunset)).then(async (log) => {
      if (cancelled) return;
      setEvening(sunset);
      if (tile && id) setSpotParam({ tile, id });
      if (log) {
        setExisting(log);
        const { rating: r, colors, view, spot, note } = log;
        setDraft({ rating: r, colors, view, spot, note });
        const stored = (await Promise.all(log.photoIds.map(getPhoto))).filter((p): p is StoredPhoto => Boolean(p));
        if (!cancelled) setPhotos(stored.map((p) => ({ ...p, url: URL.createObjectURL(p.thumb) })));
      } else if (rating >= 1 && rating <= 5) {
        setDraft((d) => ({ ...d, rating }));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [place]);

  // A spot passed in the link, or nearby spots to pick from.
  const [linkedSpot, setLinkedSpot] = useState<Spot | null>(null);
  useEffect(() => {
    if (!spotParam) return;
    let cancelled = false;
    fetch(`/data/spots/${encodeURIComponent(spotParam.tile)}.json`)
      .then((r) => r.json() as Promise<{ spots: Spot[] }>)
      .then((d) => {
        const spot = d.spots.find((s) => s.id === spotParam.id);
        if (!cancelled && spot) {
          setLinkedSpot(spot);
          setDraft((current) => (current.spot ? current : { ...current, spot: { id: spot.id, tile: spotParam.tile, name: spot.name } }));
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [spotParam]);

  const suggestions = useMemo(() => {
    if (!place || !nearby?.spots || !nearby.index) return [];
    const near = nearby.spots
      .map((s) => ({ s, d: distanceKm(place, s) }))
      .filter((x) => x.d <= 0.4)
      .sort((a, b) => a.d - b.d)
      .slice(0, 3)
      .map(({ s }) => ({ id: s.id, tile: tileKey(s.lat, s.lon, nearby.index!.tile), name: s.name }));
    const linked = linkedSpot && spotParam ? [{ id: linkedSpot.id, tile: spotParam.tile, name: linkedSpot.name }] : [];
    return [...linked, ...near.filter((s) => s.id !== linkedSpot?.id)];
  }, [place, nearby, linkedSpot, spotParam]);

  const addPhotos = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy("photos");
    setError(null);
    try {
      const room = MAX_PHOTOS - photos.length;
      const prepared = await Promise.all([...files].slice(0, room).map(preparePhoto));
      setPhotos((current) => [...current, ...prepared.map((p) => ({ ...p, url: URL.createObjectURL(p.thumb) }))]);
      if (files.length > room) setError(`Up to ${MAX_PHOTOS} photos.`);
    } catch {
      setError("Couldn't read that photo.");
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    if (!evening || !place || draft.rating < 1) return;
    setBusy("saving");
    const forecast = readCachedForecast(place);
    const sameEvening = forecast && eveningOf(forecast.sun.sunset) === eveningOf(evening);
    const log: SunsetLog = {
      ...draft,
      id: existing?.id ?? newId(),
      date: eveningOf(evening),
      at: new Date().toISOString(),
      lat: Math.round(place.lat * 100) / 100,
      lon: Math.round(place.lon * 100) / 100,
      forecast:
        existing?.forecast ??
        (sameEvening
          ? { score: forecast.score, label: forecast.label, look: forecast.look, lookTitle: forecast.lookTitle, confidence: forecast.confidence }
          : undefined),
      photoIds: photos.map((p) => p.id),
    };
    try {
      await saveLog(
        log,
        photos.map((p) => ({ id: p.id, logId: log.id, full: p.full, thumb: p.thumb, width: p.width, height: p.height })),
      );
      router.push("/me");
    } catch {
      setBusy(null);
      setError("Couldn't save on this phone. Is storage full?");
    }
  };

  const day = evening
    ? new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/London" }).format(evening)
    : "";
  const chip = (on: boolean) =>
    `min-h-11 rounded-full border px-4 text-sm font-medium ${on ? "border-[#ffc35c]/70 bg-[#ffc35c]/15 text-[#ffe2ad]" : "border-white/12 bg-white/[0.04] text-ink hover:bg-white/[0.08]"}`;

  return (
    <main className="mx-auto w-full max-w-md px-4 pt-[max(1.25rem,env(safe-area-inset-top))] pb-14">
      <Link href="/" className="inline-flex min-h-11 items-center gap-1.5 text-sm text-mist hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden="true" />
        Tonight
      </Link>
      <h1 className="mt-2 font-serif text-[40px] leading-tight">Log the sunset</h1>
      <p className="text-sm text-mist">{day ? `${day}. ` : ""}Saved on this phone.</p>

      <form
        className="mt-6 space-y-7"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <fieldset>
          <legend className="text-sm font-medium text-mist">How was it?</legend>
          <div className="mt-2 flex gap-2.5">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                aria-pressed={draft.rating === n}
                aria-label={`${n} of 5`}
                onClick={() => setDraft({ ...draft, rating: n })}
                className={`grid size-12 place-items-center rounded-full border text-base font-semibold ${
                  draft.rating === n ? "border-transparent bg-[#ffc35c] text-night" : "border-white/15 bg-white/[0.04] hover:bg-white/10"
                }`}
              >
                {n}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="text-sm font-medium text-mist">Colors</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {COLOR_TAGS.map((color) => {
              const on = draft.colors.includes(color);
              return (
                <button
                  key={color}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setDraft({ ...draft, colors: on ? draft.colors.filter((c) => c !== color) : [...draft.colors, color] })}
                  className={chip(on)}
                >
                  {color}
                </button>
              );
            })}
          </div>
        </fieldset>

        <fieldset>
          <legend className="text-sm font-medium text-mist">Where were you?</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {suggestions.map((s) => (
              <button key={s.id} type="button" aria-pressed={draft.spot?.id === s.id} onClick={() => setDraft({ ...draft, spot: s })} className={chip(draft.spot?.id === s.id)}>
                {s.name}
              </button>
            ))}
            <button type="button" aria-pressed={!draft.spot} onClick={() => setDraft({ ...draft, spot: undefined, view: undefined })} className={chip(!draft.spot)}>
              Somewhere else
            </button>
          </div>
          {draft.spot && (
            <div className="mt-4">
              <p className="text-sm text-mist">Was the view toward the sunset open?</p>
              <div className="mt-2 flex gap-2">
                {VIEW_ANSWERS.map((v) => (
                  <button key={v.id} type="button" aria-pressed={draft.view === v.id} onClick={() => setDraft({ ...draft, view: v.id })} className={chip(draft.view === v.id)}>
                    {v.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </fieldset>

        <div>
          <label htmlFor="note" className="text-sm font-medium text-mist">
            Note
          </label>
          <textarea
            id="note"
            maxLength={500}
            rows={3}
            value={draft.note ?? ""}
            onChange={(event) => setDraft({ ...draft, note: event.target.value })}
            placeholder="Anything worth remembering"
            className="mt-2 w-full rounded-2xl border border-white/12 bg-white/[0.04] p-3 text-base text-ink outline-none placeholder:text-dusk focus:border-ember/70"
          />
        </div>

        <div>
          <p className="text-sm font-medium text-mist">Photos</p>
          <div className="mt-2 grid grid-cols-3 gap-2">
            {photos.map((p) => (
              <div key={p.id} className="relative aspect-square overflow-hidden rounded-xl bg-white/5">
                {/* eslint-disable-next-line @next/next/no-img-element -- a local blob, not an optimizable image */}
                <img src={p.url} alt="" className="size-full object-cover" />
                <button
                  type="button"
                  onClick={() => setPhotos(photos.filter((x) => x.id !== p.id))}
                  aria-label="Remove photo"
                  className="absolute top-1 right-1 grid size-9 place-items-center rounded-full bg-night/80"
                >
                  <X className="size-4" />
                </button>
              </div>
            ))}
            {photos.length < MAX_PHOTOS && (
              <label className="grid aspect-square cursor-pointer place-items-center rounded-xl border border-dashed border-white/20 text-sm text-mist hover:bg-white/[0.04]">
                <span className="flex flex-col items-center gap-1">
                  <Camera className="size-5" aria-hidden="true" />
                  {busy === "photos" ? "Adding…" : "Add"}
                </span>
                <input type="file" accept="image/*" multiple className="sr-only" onChange={(event) => void addPhotos(event.target.files)} />
              </label>
            )}
          </div>
          <p className="mt-2 text-xs text-dusk">Photos are shrunk on your phone; where they were taken is removed.</p>
        </div>

        {error && (
          <p className="text-sm text-bad" role="alert">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={draft.rating < 1 || busy !== null || !evening}
          className="min-h-12 w-full rounded-full bg-ember text-base font-semibold text-night hover:brightness-110 disabled:opacity-50"
        >
          {busy === "saving" ? "Saving…" : existing ? "Update" : "Save"}
        </button>
        {draft.rating < 1 && <p className="-mt-4 text-center text-xs text-dusk">Pick a rating to save.</p>}
      </form>
    </main>
  );
}
