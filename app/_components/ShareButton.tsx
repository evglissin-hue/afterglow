"use client";

import { useState } from "react";
import { Share2 } from "lucide-react";
import type { Forecast } from "@/lib/forecast/getForecast";
import { skyPalette } from "./sky";

const W = 1080;
const H = 1920;
const HORIZON = 1500;

/** The font family behind one of the app's next/font CSS variables, for drawing on a canvas. */
function fontFamily(variable: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(variable).trim();
  return value ? `${value}, ${fallback}` : fallback;
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

/** A story-sized picture of tonight's forecast, in tonight's colors. Drawn on the phone; nothing is uploaded. */
async function drawShareCard(forecast: Forecast, placeLabel: string): Promise<Blob> {
  const sans = fontFamily("--font-geist-sans", "system-ui, sans-serif");
  const serif = fontFamily("--font-instrument-serif", "Georgia, serif");
  await Promise.all([document.fonts.load(`600 100px ${sans}`), document.fonts.load(`italic 100px ${serif}`)]).catch(() => undefined);

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  const sky = skyPalette(forecast.look, "glow");
  const time = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: forecast.location.timezone });
  const at = (iso: string) => time.format(new Date(Math.round(Date.parse(iso) / 60_000) * 60_000));

  // Sky down to a bright horizon, the sun half set, and dark ground.
  const gradient = ctx.createLinearGradient(0, 0, 0, HORIZON);
  gradient.addColorStop(0, sky.stops[0]);
  gradient.addColorStop(0.35, sky.stops[2]);
  gradient.addColorStop(0.62, sky.stops[3]);
  gradient.addColorStop(0.86, sky.glow[1]);
  gradient.addColorStop(1, sky.glow[0]);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, W, HORIZON);
  const glow = ctx.createRadialGradient(W / 2, HORIZON, 0, W / 2, HORIZON, 520);
  glow.addColorStop(0, "rgba(255, 224, 138, 0.85)");
  glow.addColorStop(0.4, "rgba(255, 179, 92, 0.35)");
  glow.addColorStop(1, "rgba(255, 138, 60, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, HORIZON);
  ctx.fillStyle = "#ffe08a";
  ctx.beginPath();
  ctx.arc(W / 2, HORIZON, 120, Math.PI, 0);
  ctx.fill();
  ctx.fillStyle = "#120c1b";
  ctx.fillRect(0, HORIZON, W, H - HORIZON);
  ctx.fillStyle = "rgba(255, 247, 236, 0.75)";
  ctx.fillRect(140, HORIZON + 14, W - 280, 10);

  ctx.textAlign = "center";
  ctx.shadowColor = "rgba(0, 0, 0, 0.35)";
  ctx.shadowBlur = 24;
  ctx.fillStyle = "rgba(255, 247, 236, 0.85)";
  ctx.font = `500 38px ${sans}`;
  ctx.letterSpacing = "8px";
  const day = Date.parse(forecast.sun.sunset) - Date.now() > 20 * 3_600_000 ? "Tomorrow" : "Tonight";
  ctx.fillText(`${day} · ${placeLabel}`.toUpperCase(), W / 2, 210);

  ctx.fillStyle = "#fff7ec";
  ctx.letterSpacing = "0px";
  ctx.font = `600 300px ${sans}`;
  ctx.fillText(String(forecast.score), W / 2, 560);
  ctx.font = `600 52px ${sans}`;
  ctx.letterSpacing = "14px";
  ctx.fillText(forecast.label.toUpperCase(), W / 2, 650);
  ctx.letterSpacing = "0px";

  ctx.font = `italic 128px ${serif}`;
  let y = 860;
  for (const line of wrap(ctx, forecast.lookTitle, 920)) {
    ctx.fillText(line, W / 2, y);
    y += 132;
  }
  ctx.font = `400 46px ${sans}`;
  ctx.fillStyle = "rgba(255, 247, 236, 0.9)";
  y += 10;
  for (const line of wrap(ctx, forecast.lookText, 860)) {
    ctx.fillText(line, W / 2, y);
    y += 62;
  }
  ctx.font = `600 50px ${sans}`;
  ctx.fillStyle = "#fff7ec";
  ctx.fillText(`Sunset ${at(forecast.sun.sunset)}  ·  Best color ${at(forecast.sun.bestColor.start)}–${at(forecast.sun.bestColor.end)}`, W / 2, Math.max(y + 70, 1260));

  ctx.shadowBlur = 0;
  ctx.font = `600 44px ${sans}`;
  ctx.fillStyle = "rgba(255, 247, 236, 0.8)";
  ctx.fillText("Afterglow", W / 2, H - 170);
  ctx.font = `400 34px ${sans}`;
  ctx.fillStyle = "rgba(255, 247, 236, 0.55)";
  ctx.fillText("Sunset forecast for London", W / 2, H - 118);

  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("No image"))), "image/png"));
}

/** Shares tonight's forecast as a picture through the phone's share sheet, or downloads it. */
export function ShareButton({ forecast, placeLabel, className = "" }: { forecast: Forecast; placeLabel: string; className?: string }) {
  const [state, setState] = useState<"idle" | "busy" | "saved" | "error">("idle");

  const share = async () => {
    setState("busy");
    try {
      const blob = await drawShareCard(forecast, placeLabel);
      const file = new File([blob], "afterglow-tonight.png", { type: "image/png" });
      const text = `Sunset ${placeLabel === "London" ? "in London" : `near ${placeLabel}`}: ${forecast.label} (${forecast.score}), ${forecast.lookTitle.toLowerCase()}.`;
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], text });
        setState("idle");
      } else {
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = file.name;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
        setState("saved");
      }
    } catch (error) {
      setState(error instanceof DOMException && error.name === "AbortError" ? "idle" : "error");
    }
  };

  return (
    <button
      type="button"
      onClick={share}
      disabled={state === "busy"}
      className={`inline-flex min-h-11 items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 text-sm font-medium backdrop-blur hover:bg-white/15 disabled:opacity-60 ${className}`}
    >
      <Share2 className="size-4" aria-hidden="true" />
      {state === "busy" ? "Making the picture…" : state === "saved" ? "Picture saved" : state === "error" ? "Couldn't share. Try again" : "Share tonight"}
    </button>
  );
}
