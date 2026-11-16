import { applyLook, prepareLook, type PhotoLook } from "@/lib/photo/looks";

/**
 * The browser half of sunset looks (lib/photo/looks.ts has the pixel math). The photo comes from
 * the phone's own camera app, so it arrives with everything that camera can do: full resolution,
 * HDR, night mode. Here it is only ever drawn at its real size for saving, never through a video
 * preview, and written out at high quality.
 */

/** Long edge of the on-screen preview. Sharp on a phone, small enough to restyle in an instant. */
const PREVIEW_EDGE = 1440;
/** Pixels per strip when finishing the full photo: about 4 MB of memory at a time. */
const STRIP_PIXELS = 1_000_000;
/** Canvas sizes to fall back to when a browser can't hold the whole photo (Safari stops near 16.7 MP). */
const FALLBACK_PIXELS = [16_000_000, 12_000_000, 8_000_000];
const JPEG_QUALITY = 0.95;

export interface LoadedPhoto {
  file: File;
  bitmap: ImageBitmap;
  width: number;
  height: number;
  /** The camera saved it in Display P3, the wider color many phones shoot in. Sunsets live in that extra orange and red. */
  wideColor: boolean;
}

export interface FinishedPhoto {
  blob: Blob;
  width: number;
  height: number;
  /** True when the browser couldn't hold every pixel and the photo was saved somewhat smaller. */
  reduced: boolean;
}

/** Reads a photo as the camera oriented it. Throws when the browser can't decode the file. */
export async function loadPhoto(file: File): Promise<LoadedPhoto> {
  const [bitmap, wideColor] = await Promise.all([createImageBitmap(file, { imageOrientation: "from-image" }), hasWideColor(file)]);
  return { file, bitmap, width: bitmap.width, height: bitmap.height, wideColor };
}

/** The color profile sits near the start of the file and names itself in plain text. */
async function hasWideColor(file: File): Promise<boolean> {
  try {
    const head = new Uint8Array(await file.slice(0, 262_144).arrayBuffer());
    const needle = [...new TextEncoder().encode("Display P3")];
    outer: for (let i = 0; i <= head.length - needle.length; i++) {
      for (let j = 0; j < needle.length; j++) if (head[i + j] !== needle[j]) continue outer;
      return true;
    }
  } catch {
    // Unreadable: treat as standard color.
  }
  return false;
}

/** A 2D context in the photo's own color space where the browser offers it, so wide color isn't squeezed into sRGB. */
function contextFor(canvas: HTMLCanvasElement, wideColor: boolean): CanvasRenderingContext2D | null {
  if (wideColor) {
    try {
      const wide = canvas.getContext("2d", { colorSpace: "display-p3", willReadFrequently: true });
      if (wide?.getContextAttributes?.().colorSpace === "display-p3") return wide;
      // A canvas keeps its first context: once a standard one came back, use it.
      if (wide) return wide;
    } catch {
      // Older browser: standard color below.
    }
  }
  return canvas.getContext("2d", { willReadFrequently: true });
}

/** Draws the photo into `canvas` at preview size with a look applied. Quick enough to call on every tap. */
export function renderPreview(photo: LoadedPhoto, look: PhotoLook, canvas: HTMLCanvasElement, edge = PREVIEW_EDGE): void {
  const scale = Math.min(1, edge / Math.max(photo.width, photo.height));
  const width = Math.max(1, Math.round(photo.width * scale));
  const height = Math.max(1, Math.round(photo.height * scale));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const ctx = contextFor(canvas, photo.wideColor);
  if (!ctx) return;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(photo.bitmap, 0, 0, width, height);
  if (!look.recipe) return;
  const image = ctx.getImageData(0, 0, width, height);
  applyLook(image.data, prepareLook(look.recipe));
  ctx.putImageData(image, 0, 0);
}

const pause = () => new Promise<void>((resolve) => setTimeout(resolve));

/**
 * The photo at full size with a look applied, as a high-quality JPEG. The untouched "Original"
 * comes back as the very file the camera wrote. Works through the photo in strips, reporting
 * progress from 0 to 1, so a big photo neither freezes the screen nor needs a second full copy in memory.
 */
export async function finishPhoto(photo: LoadedPhoto, look: PhotoLook, onProgress?: (done: number) => void): Promise<FinishedPhoto> {
  if (!look.recipe) return { blob: photo.file, width: photo.width, height: photo.height, reduced: false };

  const prepared = prepareLook(look.recipe);
  const sizes = [photo.width * photo.height, ...FALLBACK_PIXELS.filter((p) => p < photo.width * photo.height)];
  for (const pixels of sizes) {
    const scale = Math.sqrt(pixels / (photo.width * photo.height));
    const width = Math.round(photo.width * scale);
    const height = Math.round(photo.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = contextFor(canvas, photo.wideColor);
    try {
      if (!ctx) continue;
      // A canvas too large for the browser stays blank without complaint: check the far corner takes paint.
      ctx.fillRect(width - 1, height - 1, 1, 1);
      if (ctx.getImageData(width - 1, height - 1, 1, 1).data[3] === 0) continue;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(photo.bitmap, 0, 0, width, height);

      const rows = Math.max(1, Math.floor(STRIP_PIXELS / width));
      for (let y = 0; y < height; y += rows) {
        const strip = ctx.getImageData(0, y, width, Math.min(rows, height - y));
        applyLook(strip.data, prepared, y * width);
        ctx.putImageData(strip, 0, y);
        onProgress?.(Math.min(1, (y + rows) / height));
        await pause();
      }
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY));
      if (blob) return { blob, width, height, reduced: scale < 1 };
    } catch {
      // Out of memory at this size: try the next one down.
    } finally {
      canvas.width = canvas.height = 0; // Hand the memory back now.
    }
  }
  throw new Error("This photo is too large for the browser to finish.");
}

/** A file name for a finished photo: afterglow-2026-11-16-golden.jpg, or the camera's own type for the original. */
export function photoFileName(photo: LoadedPhoto, look: PhotoLook, date: string): string {
  const original = /\.(\w{3,5})$/.exec(photo.file.name)?.[1]?.toLowerCase() ?? "jpg";
  return `afterglow-${date}-${look.id}.${look.recipe ? "jpg" : original}`;
}
