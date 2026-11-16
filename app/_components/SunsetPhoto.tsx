"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Camera, Download, Images, NotebookPen, Share } from "lucide-react";
import { LOOKS, lookById, type LookId, type PhotoLook } from "@/lib/photo/looks";
import { finishPhoto, loadPhoto, photoFileName, renderPreview, type FinishedPhoto, type LoadedPhoto } from "./photoEngine";
import { eveningOf, keepPendingPhoto, preparePhoto } from "./sunsetLog";

/** The look a new photo opens with: the one made for the usual phone sunset, too pale and too cool. */
const FIRST_LOOK: LookId = "golden";
const THUMB_EDGE = 160;

type Busy = { what: "opening" } | { what: "finishing"; done: number } | null;

/**
 * A sunset photo with a look: taken with the phone's own camera (or picked from its photos), shown
 * with three looks and the original, and saved at full size. Nothing leaves the phone.
 */
export function SunsetPhoto() {
  const router = useRouter();
  const [photo, setPhoto] = useState<LoadedPhoto | null>(null);
  const [lookId, setLookId] = useState<LookId>(FIRST_LOOK);
  const [comparing, setComparing] = useState(false);
  const [busy, setBusy] = useState<Busy>(null);
  const [note, setNote] = useState<{ text: string; tone: "ok" | "bad" } | null>(null);
  const [canShare, setCanShare] = useState(false);
  const preview = useRef<HTMLCanvasElement>(null);
  const finished = useRef(new Map<LookId, FinishedPhoto>());
  const look = lookById(lookId);

  useEffect(() => {
    // Sharing files is a phone thing; desktop browsers mostly only download.
    const probe = new File([""], "probe.jpg", { type: "image/jpeg" });
    // eslint-disable-next-line react-hooks/set-state-in-effect -- only known in the browser, after the first paint
    setCanShare(Boolean(navigator.canShare?.({ files: [probe] })));
  }, []);

  // Free the decoded photo when it's replaced or the screen closes.
  useEffect(() => () => photo?.bitmap.close(), [photo]);

  useEffect(() => {
    if (photo && preview.current) renderPreview(photo, comparing ? LOOKS[0] : look, preview.current);
  }, [photo, look, comparing]);

  const open = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    setBusy({ what: "opening" });
    setNote(null);
    try {
      const loaded = await loadPhoto(file);
      finished.current.clear();
      setLookId(FIRST_LOOK);
      setPhoto(loaded);
    } catch {
      setNote({ text: "Couldn't open that photo. Try another, or take a new one.", tone: "bad" });
    } finally {
      setBusy(null);
    }
  };

  /** The full-size photo with the chosen look, made once per look. */
  const finish = useCallback(async (): Promise<{ result: FinishedPhoto; file: File } | null> => {
    if (!photo) return null;
    setNote(null);
    try {
      let result = finished.current.get(look.id);
      if (!result) {
        setBusy({ what: "finishing", done: 0 });
        result = await finishPhoto(photo, look, (done) => setBusy({ what: "finishing", done }));
        finished.current.set(look.id, result);
      }
      const name = photoFileName(photo, look, eveningOf(new Date()));
      return { result, file: new File([result.blob], name, { type: result.blob.type || photo.file.type || "image/jpeg" }) };
    } catch {
      setNote({ text: "Couldn't finish this photo: the phone ran out of room for it. Close other apps and try again.", tone: "bad" });
      return null;
    } finally {
      setBusy(null);
    }
  }, [photo, look]);

  const sizeText = (r: FinishedPhoto) =>
    `${r.width} × ${r.height}${r.reduced ? ", a little under full size: this browser can't hold more" : ", full size"}`;

  const save = async () => {
    const made = await finish();
    if (!made) return;
    const url = URL.createObjectURL(made.file);
    const link = document.createElement("a");
    link.href = url;
    link.download = made.file.name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
    setNote({ text: `Saved to your downloads at ${sizeText(made.result)}.`, tone: "ok" });
  };

  const share = async () => {
    const made = await finish();
    if (!made) return;
    try {
      await navigator.share({ files: [made.file] });
    } catch (error) {
      if ((error as Error).name !== "AbortError") setNote({ text: "Couldn't open sharing. Save it instead.", tone: "bad" });
    }
  };

  const addToLog = async () => {
    const made = await finish();
    if (!made) return;
    try {
      const stored = await preparePhoto(made.file);
      await keepPendingPhoto(stored);
      router.push(`/log?photo=${stored.id}`);
    } catch {
      setNote({ text: "Couldn't add it to the log. Is the phone's storage full?", tone: "bad" });
    }
  };

  const action = "inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-full px-4 text-sm font-semibold disabled:opacity-50";

  return (
    <main className="mx-auto w-full max-w-md px-4 pt-[max(1.25rem,env(safe-area-inset-top))] pb-14">
      <Link href="/" className="inline-flex min-h-11 items-center gap-1.5 text-sm text-mist hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden="true" />
        Tonight
      </Link>
      <h1 className="mt-2 font-serif text-[40px] leading-tight">Sunset photo</h1>

      {!photo ? (
        <>
          <p className="mt-1 text-[15px] leading-relaxed text-mist">
            Take it with your phone&apos;s own camera, so you get everything it can do. Then pick a look and save it at full
            size.
          </p>
          <div className="mt-6 grid gap-3">
            <label className={`${action} cursor-pointer bg-ember text-night hover:brightness-110`}>
              <Camera className="size-5" aria-hidden="true" />
              {busy?.what === "opening" ? "Opening…" : "Take a photo"}
              <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(event) => void open(event.target.files)} />
            </label>
            <label className={`${action} cursor-pointer border border-white/15 bg-white/[0.04] hover:bg-white/10`}>
              <Images className="size-5" aria-hidden="true" />
              Choose from your photos
              <input type="file" accept="image/*" className="sr-only" onChange={(event) => void open(event.target.files)} />
            </label>
          </div>
          <p className="mt-4 text-xs leading-relaxed text-dusk">
            Tip: tap the brightest part of the sky in your camera before you shoot, so the colors aren&apos;t washed out.
            The photo stays on your phone.
          </p>
        </>
      ) : (
        <>
          <div className="relative mt-4 overflow-hidden rounded-2xl bg-white/5">
            <canvas
              ref={preview}
              role="img"
              aria-label={`Your photo with the ${comparing ? "Original" : look.name} look. Hold to compare with the original.`}
              className="block max-h-[58vh] w-full object-contain select-none [-webkit-touch-callout:none]"
              onPointerDown={() => setComparing(true)}
              onPointerUp={() => setComparing(false)}
              onPointerLeave={() => setComparing(false)}
              onPointerCancel={() => setComparing(false)}
              onContextMenu={(event) => event.preventDefault()}
            />
            {comparing && <span className="absolute top-2 left-2 rounded-full bg-night/75 px-2.5 py-1 text-xs">Original</span>}
          </div>
          <p className="mt-2 text-center text-xs text-dusk">
            {look.hint}
            {look.recipe ? " · hold the photo to compare" : ""}
          </p>

          <div className="mt-3 grid grid-cols-4 gap-2" role="radiogroup" aria-label="Look">
            {LOOKS.map((option) => (
              <LookButton key={option.id} photo={photo} look={option} selected={option.id === lookId} onSelect={() => setLookId(option.id)} />
            ))}
          </div>

          <div className="mt-5 flex gap-2.5">
            <button type="button" onClick={() => void save()} disabled={busy !== null} className={`${action} bg-ember text-night hover:brightness-110`}>
              <Download className="size-4" aria-hidden="true" />
              Save
            </button>
            {canShare && (
              <button type="button" onClick={() => void share()} disabled={busy !== null} className={`${action} border border-white/15 bg-white/[0.04] hover:bg-white/10`}>
                <Share className="size-4" aria-hidden="true" />
                Share
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={() => void addToLog()}
            disabled={busy !== null}
            className={`${action} mt-2.5 w-full border border-white/15 bg-white/[0.04] hover:bg-white/10`}
          >
            <NotebookPen className="size-4" aria-hidden="true" />
            Add to tonight&apos;s log
          </button>

          <div className="mt-3 min-h-10 text-center text-sm" aria-live="polite">
            {busy?.what === "finishing" ? (
              <>
                <p className="text-mist">Finishing every pixel… {Math.round(busy.done * 100)}%</p>
                <div className="mx-auto mt-2 h-1 w-40 overflow-hidden rounded-full bg-white/10">
                  <div className="h-full rounded-full bg-ember" style={{ width: `${Math.round(busy.done * 100)}%` }} />
                </div>
              </>
            ) : note ? (
              <p className={note.tone === "bad" ? "text-bad" : "text-mist"} role={note.tone === "bad" ? "alert" : undefined}>
                {note.text}
              </p>
            ) : (
              <p className="text-xs text-dusk">
                {photo.width} × {photo.height} from your camera. Saved at that size, never the small preview.
              </p>
            )}
          </div>

          <div className="mt-4 flex justify-center gap-5 text-sm text-mist">
            <label className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 hover:text-ink">
              <Camera className="size-4" aria-hidden="true" />
              Take another
              <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(event) => void open(event.target.files)} />
            </label>
            <label className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 hover:text-ink">
              <Images className="size-4" aria-hidden="true" />
              Choose another
              <input type="file" accept="image/*" className="sr-only" onChange={(event) => void open(event.target.files)} />
            </label>
          </div>
        </>
      )}

      {!photo && note && (
        <p className="mt-4 text-sm text-bad" role="alert">
          {note.text}
        </p>
      )}
    </main>
  );
}

/** A look as a small square of the photo itself, so the choice is made by eye. */
function LookButton({ photo, look, selected, onSelect }: { photo: LoadedPhoto; look: PhotoLook; selected: boolean; onSelect: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (canvas.current) renderPreview(photo, look, canvas.current, THUMB_EDGE);
  }, [photo, look]);

  return (
    <button type="button" role="radio" aria-checked={selected} onClick={onSelect} className="group text-center">
      <canvas
        ref={canvas}
        aria-hidden="true"
        className={`aspect-square w-full rounded-xl object-cover ring-2 ring-offset-2 ring-offset-night ${selected ? "ring-[#ffc35c]" : "ring-transparent group-hover:ring-white/25"}`}
      />
      <span className={`mt-1.5 block text-xs font-medium ${selected ? "text-[#ffe2ad]" : "text-mist"}`}>{look.name}</span>
    </button>
  );
}
