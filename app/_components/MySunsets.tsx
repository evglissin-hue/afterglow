"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft, Plus, Star, Trash2 } from "lucide-react";
import { deleteLog, getPhoto, listLogs, type SunsetLog } from "./sunsetLog";

/** Good evening by the forecast's measure (Good or better) and by yours (3 of 5 or more). */
const forecastSaidGood = (score: number) => score >= 45;
const youSaidGood = (rating: number) => rating >= 3;

/** Your logged sunsets, newest first, with how the forecast did against your ratings. */
export function MySunsets() {
  const [logs, setLogs] = useState<SunsetLog[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    listLogs().then(
      (all) => !cancelled && setLogs(all),
      () => !cancelled && setFailed(true),
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const remove = async (log: SunsetLog) => {
    if (!window.confirm("Delete this sunset and its photos from your phone?")) return;
    await deleteLog(log);
    setLogs((current) => current?.filter((l) => l.id !== log.id) ?? null);
  };

  const rated = (logs ?? []).filter((l) => l.forecast);
  const matched = rated.filter((l) => forecastSaidGood(l.forecast!.score) === youSaidGood(l.rating)).length;

  return (
    <main className="mx-auto w-full max-w-md px-4 pt-[max(1.25rem,env(safe-area-inset-top))] pb-14">
      <Link href="/" className="inline-flex min-h-11 items-center gap-1.5 text-sm text-mist hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden="true" />
        Tonight
      </Link>
      <div className="mt-2 flex items-end justify-between gap-3">
        <h1 className="font-serif text-[40px] leading-tight">My sunsets</h1>
        <Link href="/log" className="mb-1 inline-flex min-h-11 items-center gap-1.5 rounded-full bg-ember px-4 text-sm font-semibold text-night hover:brightness-110">
          <Plus className="size-4" aria-hidden="true" />
          Log
        </Link>
      </div>

      {failed ? (
        <p className="mt-6 text-mist">Couldn&apos;t open the sunsets saved on this phone.</p>
      ) : !logs ? (
        <p className="mt-6 text-mist">Loading…</p>
      ) : logs.length === 0 ? (
        <p className="mt-6 text-mist">
          Nothing logged yet. After a sunset, rate it in live mode or log it here, with photos if you like. It&apos;s how
          the forecast gets better.
        </p>
      ) : (
        <>
          <section className="mt-5 rounded-2xl border border-white/10 bg-white/[0.04] p-4" aria-labelledby="how">
            <h2 id="how" className="text-sm font-medium text-mist">
              How the forecast did
            </h2>
            {rated.length ? (
              <>
                <p className="mt-1 text-2xl font-semibold">
                  Right {matched} of {rated.length} {rated.length === 1 ? "evening" : "evenings"}
                </p>
                <p className="mt-1 text-xs leading-relaxed text-dusk">
                  Right means it said Good or better and you gave it 3 or more, or it said Fair or Poor and you gave it 1
                  or 2.
                </p>
              </>
            ) : (
              <p className="mt-1 text-sm text-mist">Log an evening when the forecast is open on this phone to compare.</p>
            )}
          </section>

          <ul className="mt-4 space-y-3">
            {logs.map((log) => (
              <LogCard key={log.id} log={log} onDelete={() => void remove(log)} />
            ))}
          </ul>
          <p className="mt-6 text-xs leading-relaxed text-dusk">
            Saved on this phone only. When accounts arrive, you&apos;ll be able to upload them, share photos and help tune
            the forecast.
          </p>
        </>
      )}
    </main>
  );
}

function LogCard({ log, onDelete }: { log: SunsetLog; onDelete: () => void }) {
  const [thumbs, setThumbs] = useState<string[]>([]);
  useEffect(() => {
    let cancelled = false;
    const urls: string[] = [];
    Promise.all(log.photoIds.map(getPhoto)).then((photos) => {
      if (cancelled) return;
      for (const p of photos) if (p) urls.push(URL.createObjectURL(p.thumb));
      setThumbs([...urls]);
    });
    return () => {
      cancelled = true;
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [log.photoIds]);

  const day = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" }).format(
    new Date(`${log.date}T12:00:00Z`),
  );
  const match = log.forecast ? forecastSaidGood(log.forecast.score) === youSaidGood(log.rating) : null;

  return (
    <li className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-mist">{day}</p>
          <p className="mt-0.5 flex items-center gap-0.5" aria-label={`${log.rating} of 5`}>
            {[1, 2, 3, 4, 5].map((n) => (
              <Star key={n} className={`size-4 ${n <= log.rating ? "fill-[#ffc35c] text-[#ffc35c]" : "text-white/20"}`} aria-hidden="true" />
            ))}
          </p>
          {log.spot && (
            <Link href={`/spots/${log.spot.tile}/${log.spot.id}`} className="mt-1 block truncate text-sm underline-offset-2 hover:underline">
              {log.spot.name}
              {log.view ? ` · view ${log.view === "yes" ? "open" : log.view}` : ""}
            </Link>
          )}
        </div>
        <button type="button" onClick={onDelete} aria-label="Delete" className="-m-1 rounded-full p-2.5 text-dusk hover:bg-white/10 hover:text-ink">
          <Trash2 className="size-4" />
        </button>
      </div>
      {log.colors.length > 0 && <p className="mt-2 text-sm">{log.colors.join(", ")}</p>}
      {log.note && <p className="mt-2 text-sm whitespace-pre-line text-mist">{log.note}</p>}
      {thumbs.length > 0 && (
        <div className="mt-3 grid grid-cols-3 gap-2">
          {thumbs.map((url) => (
            // eslint-disable-next-line @next/next/no-img-element -- a local blob, not an optimizable image
            <img key={url} src={url} alt="" className="aspect-square w-full rounded-xl object-cover" />
          ))}
        </div>
      )}
      {log.forecast && (
        <p className="mt-3 text-xs text-dusk">
          Forecast: {log.forecast.label} ({log.forecast.score}){log.forecast.lookTitle ? `, ${log.forecast.lookTitle.toLowerCase()}` : ""}
          {match === null ? "" : match ? " · right" : " · off"}
        </p>
      )}
    </li>
  );
}
