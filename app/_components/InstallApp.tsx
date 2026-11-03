"use client";

import { useEffect, useState } from "react";
import { Share, X } from "lucide-react";

/** Chrome's offer to install the app, kept by the script in app/layout.tsx. */
type InstallOffer = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

declare global {
  interface Window {
    __installOffer?: InstallOffer;
  }
}

const DISMISSED_KEY = "afterglow:install-dismissed";

const isInstalled = () =>
  window.matchMedia("(display-mode: standalone)").matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;

const isIos = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

/**
 * A card offering to add Afterglow to the home screen: a button where the browser can install it
 * (Chrome on Android, desktop), and the Share → Add to Home Screen steps on iPhone.
 */
export function InstallApp() {
  const [mode, setMode] = useState<"hidden" | "button" | "ios">("hidden");

  useEffect(() => {
    let dismissed = false;
    try {
      dismissed = localStorage.getItem(DISMISSED_KEY) === "1";
    } catch {
      // Storage blocked: show the card.
    }
    if (dismissed) return;
    const update = () =>
      setMode(isInstalled() ? "hidden" : window.__installOffer ? "button" : isIos() ? "ios" : "hidden");
    const installed = () => {
      window.__installOffer = undefined;
      setMode("hidden");
    };
    const first = setTimeout(update, 0);
    window.addEventListener("afterglow:installoffer", update);
    window.addEventListener("appinstalled", installed);
    return () => {
      clearTimeout(first);
      window.removeEventListener("afterglow:installoffer", update);
      window.removeEventListener("appinstalled", installed);
    };
  }, []);

  if (mode === "hidden") return null;

  const install = async () => {
    const offer = window.__installOffer;
    if (!offer) return;
    // The offer works once; Chrome makes a new one later if this one is turned down.
    window.__installOffer = undefined;
    await offer.prompt();
    await offer.userChoice;
    setMode("hidden");
  };

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISSED_KEY, "1");
    } catch {
      // Storage blocked: it will ask again next time.
    }
    setMode("hidden");
  };

  return (
    <section className="mt-6 flex items-start gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-4" aria-labelledby="install-app">
      <AppIcon />
      <div className="min-w-0 flex-1">
        <h2 id="install-app" className="font-medium">
          Get the app
        </h2>
        {mode === "button" ? (
          <>
            <p className="mt-0.5 text-sm text-mist">
              Add Afterglow to your home screen. It opens full screen, like any other app.
            </p>
            <button
              type="button"
              onClick={install}
              className="mt-3 rounded-full bg-ember px-4 py-2 text-sm font-semibold text-night hover:brightness-110"
            >
              Install
            </button>
          </>
        ) : (
          <p className="mt-0.5 text-sm text-mist">
            Tap <Share className="inline size-4 align-[-3px]" aria-label="Share" /> Share, then{" "}
            <span className="text-ink">Add to Home Screen</span>. It opens full screen, like any other app.
          </p>
        )}
      </div>
      <button type="button" onClick={dismiss} className="-m-1 rounded-full p-2 text-mist hover:bg-white/10" aria-label="Not now">
        <X className="size-4" />
      </button>
    </section>
  );
}

function AppIcon() {
  return (
    <svg viewBox="0 0 64 64" className="size-11 shrink-0" aria-hidden="true">
      <defs>
        <linearGradient id="install-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2b1650" />
          <stop offset="0.6" stopColor="#c2257a" />
          <stop offset="1" stopColor="#ff9a3c" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="14" fill="url(#install-sky)" />
      <path d="M14 43a18 18 0 0 1 36 0z" fill="#ffd36b" />
      <rect x="10" y="45" width="44" height="3" rx="1.5" fill="#fff7ec" opacity="0.9" />
    </svg>
  );
}
