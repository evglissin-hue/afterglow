"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, Bell, BellOff, Check, CircleAlert, LocateFixed, MapPin, Send, Share } from "lucide-react";
import {
  ALERT_LABELS,
  DEFAULT_ALERT_SETTINGS,
  LEAD_MINUTES,
  minScoreFor,
  type AlertSettings as Settings,
} from "@/lib/alerts";
import {
  alertWorker,
  currentSubscription,
  forgetSync,
  keyBytes,
  madeWithKey,
  postJson,
  pushSupport,
  readAlertSettings,
  readFavorites,
  saveAlertSettings,
  saveSubscription,
  subscriptionBody,
  syncKey,
  type ApiResult,
} from "./alertsClient";
import { WALK_OPTIONS, usePlace, useWalkMinutes, type Place } from "./usePlace";

type Status = "checking" | "off" | "on" | "blocked" | "ios-install" | "ios-update" | "unsupported";
type Busy = "on" | "off" | "test" | null;
type Notice = { tone: "ok" | "error"; text: string; id: number };

const CARD = "rounded-2xl border border-white/10 bg-white/[0.04] p-4";

/** The alerts screen: switch alerts on or off for this device and choose when to hear about a sunset. */
export default function AlertSettings({ configured, publicKey }: { configured: boolean; publicKey: string | null }) {
  return (
    <main className="mx-auto w-full max-w-md px-4 pt-[max(1.25rem,env(safe-area-inset-top))] pb-24">
      <Link href="/" className="-ml-2 inline-flex min-h-11 items-center gap-1.5 px-2 text-sm text-mist hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden="true" />
        Tonight
      </Link>
      <h1 className="mt-4 text-3xl font-semibold tracking-tight">Sunset alerts</h1>
      <p className="mt-3 text-mist">A nudge on your phone when tonight&apos;s sunset looks worth stepping out for.</p>
      {configured && publicKey ? <Alerts publicKey={publicKey} /> : <NotSwitchedOn />}
    </main>
  );
}

type Device = { settings: Settings; status: Status; subscription: PushSubscription | null };

/** Saved settings and whether this device can get alerts, and has them on. Browser only. */
async function readDevice(publicKey: string): Promise<Device> {
  const settings = readAlertSettings();
  const support = pushSupport();
  if (support !== "supported") return { settings, status: support, subscription: null };
  if (Notification.permission === "denied") return { settings, status: "blocked", subscription: null };
  const found = await currentSubscription().catch(() => null);
  // A subscription made with an older server key can't receive alerts any more.
  const subscription = found && madeWithKey(found, publicKey) ? found : null;
  const on = subscription !== null && Notification.permission === "granted";
  return { settings, status: on ? "on" : "off", subscription: on ? subscription : null };
}

function problem(result: Extract<ApiResult, { ok: false }>): string {
  if (result.status === null || result.status === 429 || result.status === 410) return result.error;
  if (result.status === 503) return "Alerts aren't switched on yet.";
  if (result.status >= 500) return "Couldn't save just now. Try again in a minute.";
  console.error("Alerts request refused:", result.error);
  return "Something went wrong. Reload the page and try again.";
}

function Alerts({ publicKey }: { publicKey: string }) {
  const { place, locate, chooseLondon } = usePlace();
  const [walk, setWalk] = useWalkMinutes();
  const [settings, setSettings] = useState<Settings>(DEFAULT_ALERT_SETTINGS);
  const [status, setStatus] = useState<Status>("checking");
  const [subscription, setSubscription] = useState<PushSubscription | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const synced = useRef<string | null>(null);
  const queue = useRef<Promise<void>>(Promise.resolve());

  const show = (tone: Notice["tone"], text: string) => setNotice({ tone, text, id: Date.now() });

  useEffect(() => {
    let cancelled = false;
    readDevice(publicKey).then((device) => {
      if (cancelled) return;
      setSettings(device.settings);
      setSubscription(device.subscription);
      setStatus(device.status);
    });
    return () => {
      cancelled = true;
    };
  }, [publicKey]);

  // While alerts are on, keep the server's copy of the settings, place and walk up to date. The
  // first save after the page opens is silent; it also restores the subscription if the server lost it.
  useEffect(() => {
    if (status !== "on" || !subscription || !place) return;
    const where = { lat: place.lat, lon: place.lon, walkMinutes: walk };
    const body = subscriptionBody(subscription, settings, where, readFavorites());
    const key = syncKey(body);
    if (key === synced.current) return;
    const quiet = synced.current === null;
    synced.current = key;
    // One save at a time, in order, so the last change is the one the server keeps.
    queue.current = queue.current.then(async () => {
      const result = await saveSubscription(body);
      if (!result.ok) setNotice({ tone: "error", text: problem(result), id: Date.now() });
      else if (!quiet) setNotice({ tone: "ok", text: "Saved", id: Date.now() });
    });
  }, [status, subscription, place, walk, settings]);

  useEffect(() => {
    if (!notice) return;
    const clear = () => setNotice((current) => (current?.id === notice.id ? null : current));
    const id = setTimeout(clear, notice.tone === "ok" ? 2500 : 6000);
    return () => clearTimeout(id);
  }, [notice]);

  async function switchOn() {
    if (!place) return;
    setBusy("on");
    setNotice(null);
    // Ask straight away: Safari only shows the question in direct response to a tap.
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      setBusy(null);
      if (permission === "denied") setStatus("blocked");
      else show("error", "Alerts need permission to show notifications.");
      return;
    }
    try {
      const registration = await alertWorker();
      if (!registration) throw new Error("The service worker only runs in production builds.");
      let sub = await registration.pushManager.getSubscription();
      if (sub && !madeWithKey(sub, publicKey)) {
        await sub.unsubscribe();
        sub = null;
      }
      sub ??= await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: keyBytes(publicKey),
      });
      const body = subscriptionBody(sub, settings, { lat: place.lat, lon: place.lon, walkMinutes: walk }, readFavorites());
      const result = await saveSubscription(body);
      if (!result.ok) {
        await sub.unsubscribe().catch(() => undefined);
        show("error", problem(result));
        return;
      }
      synced.current = syncKey(body);
      setSubscription(sub);
      setStatus("on");
      show("ok", "Alerts are on");
    } catch (error) {
      console.error("Couldn't switch alerts on:", error);
      show("error", "Couldn't switch alerts on in this browser. Try again, or try another browser.");
    } finally {
      setBusy(null);
    }
  }

  async function switchOff() {
    if (!subscription) return;
    setBusy("off");
    setNotice(null);
    // Either is enough: once the browser drops it, the next alert bounces and the server deletes it too.
    await Promise.allSettled([
      subscription.unsubscribe(),
      postJson("/api/push/unsubscribe", { endpoint: subscription.endpoint }),
    ]);
    forgetSync();
    synced.current = null;
    setSubscription(null);
    setStatus("off");
    setBusy(null);
    show("ok", "Alerts are off");
  }

  async function sendTest() {
    if (!subscription) return;
    setBusy("test");
    const result = await postJson("/api/push/test", { endpoint: subscription.endpoint });
    setBusy(null);
    if (result.ok) {
      show("ok", "Sent. It should arrive in a few seconds.");
    } else if (result.status === 410) {
      await subscription.unsubscribe().catch(() => undefined);
      forgetSync();
      synced.current = null;
      setSubscription(null);
      setStatus("off");
      show("error", "Alerts had expired on this device. Switch them on again.");
    } else if (result.status === 404 && place) {
      // The server lost this device (say, its database was reset): save it again.
      const where = { lat: place.lat, lon: place.lon, walkMinutes: walk };
      const body = subscriptionBody(subscription, settings, where, readFavorites());
      const saved = await saveSubscription(body);
      if (saved.ok) {
        synced.current = syncKey(body);
        show("ok", "Saved this device again. Send the test once more.");
      } else {
        show("error", problem(saved));
      }
    } else {
      show("error", problem(result));
    }
  }

  function change(patch: Partial<Settings>) {
    const next = { ...settings, ...patch };
    setSettings(next);
    saveAlertSettings(next);
  }

  if (status === "checking") {
    return (
      <div className={`${CARD} mt-6 h-24 animate-pulse`} role="status">
        <span className="sr-only">Checking this device…</span>
      </div>
    );
  }
  if (status === "ios-install") return <AddToHomeScreen />;
  if (status === "ios-update" || status === "unsupported") {
    return (
      <Message icon={<BellOff className="size-5" />} title="This browser can't show alerts">
        {status === "ios-update"
          ? "Alerts need iOS 16.4 or later. Update your iPhone, then open Afterglow from your home screen again."
          : "Try Chrome, Edge or Firefox, or Safari on a Mac. On iPhone, add Afterglow to your home screen first."}
      </Message>
    );
  }

  const on = status === "on";
  const leadHours = settings.leadMinutes / 60;
  const summary =
    busy === "on"
      ? "Switching on…"
      : busy === "off"
        ? "Switching off…"
        : status === "blocked"
          ? "Notifications are blocked"
          : on
            ? `On. We check ${leadHours} h before sunset.`
            : "Off";

  return (
    <div className="mt-6 space-y-4">
      <section className={CARD} aria-labelledby="alerts-switch">
        <div className="flex items-center gap-3">
          <span
            className={`grid size-10 shrink-0 place-items-center rounded-full ${on ? "bg-ember/15 text-ember" : "bg-white/10 text-mist"}`}
            aria-hidden="true"
          >
            {on ? <Bell className="size-5" /> : <BellOff className="size-5" />}
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="alerts-switch" className="font-medium">
              Alerts on this device
            </h2>
            <p className="text-sm text-mist">{summary}</p>
          </div>
          <Switch
            labelledBy="alerts-switch"
            checked={on}
            disabled={busy !== null || status === "blocked" || (!on && !place)}
            onChange={(next) => (next ? switchOn() : switchOff())}
          />
        </div>
        {status === "blocked" && (
          <p className="mt-3 text-sm text-mist">
            Allow notifications for this site in your browser&apos;s settings, then reload this page.
          </p>
        )}
        {on && (
          <button
            type="button"
            onClick={sendTest}
            disabled={busy !== null}
            className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-full bg-white/10 px-4 text-sm font-medium hover:bg-white/15 disabled:opacity-50"
          >
            <Send className="size-4" aria-hidden="true" />
            {busy === "test" ? "Sending…" : "Send a test alert"}
          </button>
        )}
      </section>

      <section className={CARD} aria-labelledby="alerts-when">
        <h2 id="alerts-when" className="text-sm font-medium text-mist">
          Tell me when it looks at least
        </h2>
        <Choices
          label="Lowest score"
          options={ALERT_LABELS.map((label) => ({ value: label, label, hint: `${minScoreFor(label)}+` }))}
          value={settings.minLabel}
          onChange={(minLabel) => change({ minLabel })}
        />
        <h3 className="mt-5 text-sm font-medium text-mist">How early</h3>
        <Choices
          label="How early"
          options={LEAD_MINUTES.map((minutes) => ({ value: minutes, label: `${minutes / 60} h`, hint: "before sunset" }))}
          value={settings.leadMinutes}
          onChange={(leadMinutes) => change({ leadMinutes })}
        />
      </section>

      <section className={`${CARD} divide-y divide-white/10 py-1`} aria-label="Extra alerts">
        <Toggle
          id="alerts-now"
          title="Also tell me when it's happening"
          text="A nudge about 10 minutes before sunset."
          checked={settings.happeningNow}
          onChange={(happeningNow) => change({ happeningNow })}
        />
        <Toggle
          id="alerts-better"
          title="Tell me if the forecast improves"
          text="If it looks too dull at first, but gets better later."
          checked={settings.upgrades}
          onChange={(upgrades) => change({ upgrades })}
        />
      </section>

      <PlaceCard place={place} walk={walk} onWalk={setWalk} onUseDevice={locate} onUseLondon={chooseLondon} />

      <p className="px-1 text-xs leading-relaxed text-dusk">
        At most one alert a day, plus one when it&apos;s happening. Forecasts are best guesses, and cloud forecasts
        can be wrong.
      </p>

      <Toast notice={notice} />
    </div>
  );
}

function PlaceCard({
  place,
  walk,
  onWalk,
  onUseDevice,
  onUseLondon,
}: {
  place: Place | null;
  walk: number;
  onWalk: (minutes: number) => void;
  onUseDevice: () => void;
  onUseLondon: () => void;
}) {
  return (
    <section className={CARD} aria-labelledby="alerts-place">
      <h2 id="alerts-place" className="text-sm font-medium text-mist">
        Place
      </h2>
      <p className="mt-2 flex items-center gap-2 font-medium">
        <MapPin className="size-4 shrink-0 text-mist" aria-hidden="true" />
        {!place ? "Finding you…" : place.source === "device" ? "Near you" : "Central London"}
      </p>
      <p className="mt-1 text-sm text-mist">Rounded to about 1 km before it&apos;s saved for alerts.</p>
      {place && (
        <button
          type="button"
          onClick={place.source === "device" ? onUseLondon : onUseDevice}
          className="-ml-2 mt-1 inline-flex min-h-11 items-center gap-1.5 px-2 text-sm text-mist underline underline-offset-2 hover:text-ink"
        >
          {place.source === "device" ? (
            "Use central London instead"
          ) : (
            <>
              <LocateFixed className="size-4" aria-hidden="true" />
              Use my location
            </>
          )}
        </button>
      )}
      <h3 className="mt-3 text-sm font-medium text-mist">Best spot within a walk of</h3>
      <Choices
        label="Walking time"
        options={WALK_OPTIONS.map((minutes) => ({ value: minutes, label: `${minutes} min` }))}
        value={walk}
        onChange={onWalk}
      />
      <p className="mt-2 text-xs leading-relaxed text-dusk">
        Alerts name the spot with the best view tonight, or one of your favorites if its view is open.
      </p>
    </section>
  );
}

function Choices<T extends string | number>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: T; label: string; hint?: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div
      className="mt-2 grid gap-1 rounded-2xl border border-white/10 p-1"
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
      role="group"
      aria-label={label}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            aria-pressed={selected}
            className={`flex min-h-11 flex-col items-center justify-center rounded-xl px-2 py-1.5 text-sm ${
              selected ? "bg-white/15 font-medium text-ink" : "text-mist hover:bg-white/5 hover:text-ink"
            }`}
          >
            {option.label}
            {option.hint && <span className={`text-[11px] ${selected ? "text-mist" : "text-dusk"}`}>{option.hint}</span>}
          </button>
        );
      })}
    </div>
  );
}

function Toggle({
  id,
  title,
  text,
  checked,
  onChange,
}: {
  id: string;
  title: string;
  text: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-3 py-3">
      <div className="min-w-0 flex-1">
        <p id={id} className="font-medium">
          {title}
        </p>
        <p className="text-sm text-mist">{text}</p>
      </div>
      <Switch labelledBy={id} checked={checked} onChange={onChange} />
    </div>
  );
}

function Switch({
  labelledBy,
  checked,
  disabled = false,
  onChange,
}: {
  labelledBy: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={labelledBy}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="group -mr-1 inline-flex h-11 w-16 shrink-0 items-center justify-center rounded-full disabled:opacity-50"
    >
      <span
        className={`relative h-7 w-12 rounded-full transition-colors ${checked ? "bg-ember" : "bg-white/15 group-hover:bg-white/20"}`}
      >
        <span
          className={`absolute top-1 left-1 size-5 rounded-full bg-ink shadow transition-transform ${checked ? "translate-x-5" : ""}`}
        />
      </span>
    </button>
  );
}

function Toast({ notice }: { notice: Notice | null }) {
  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-[max(1rem,env(safe-area-inset-bottom))] z-10 flex justify-center px-4"
      role="status"
      aria-live="polite"
    >
      {notice && (
        <p
          className={`flex max-w-md items-center gap-2 rounded-2xl border px-4 py-2.5 text-sm shadow-lg ${
            notice.tone === "ok" ? "border-white/10 bg-night/95 text-ink" : "border-bad/40 bg-night/95 text-bad"
          }`}
        >
          {notice.tone === "ok" ? (
            <Check className="size-4 shrink-0 text-good" aria-hidden="true" />
          ) : (
            <CircleAlert className="size-4 shrink-0" aria-hidden="true" />
          )}
          {notice.text}
        </p>
      )}
    </div>
  );
}

function Message({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <section className={`${CARD} mt-6 flex items-start gap-3`}>
      <span className="mt-0.5 shrink-0 text-mist" aria-hidden="true">
        {icon}
      </span>
      <div>
        <h2 className="font-medium">{title}</h2>
        <div className="mt-1 text-sm leading-relaxed text-mist">{children}</div>
      </div>
    </section>
  );
}

function NotSwitchedOn() {
  return (
    <Message icon={<BellOff className="size-5" />} title="Alerts aren't switched on yet">
      <p>They&apos;re on the way. Until then, check Tonight before you head out.</p>
      <Link
        href="/"
        className="mt-3 inline-flex min-h-11 items-center rounded-full bg-white/10 px-4 font-medium text-ink hover:bg-white/15"
      >
        See tonight&apos;s forecast
      </Link>
    </Message>
  );
}

function AddToHomeScreen() {
  return (
    <Message icon={<Bell className="size-5" />} title="On iPhone, add Afterglow to your home screen first">
      <p>Alerts only work in the app on your home screen.</p>
      <ol className="mt-3 space-y-2">
        <li>
          1. Tap <Share className="inline size-4 align-[-3px] text-ink" aria-label="Share" /> Share in Safari.
        </li>
        <li>
          2. Tap <span className="text-ink">Add to Home Screen</span>.
        </li>
        <li>3. Open Afterglow from your home screen and switch alerts on here.</li>
      </ol>
    </Message>
  );
}
