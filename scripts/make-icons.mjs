// Renders the app icons in public/icons/ and app/apple-icon.png from the SVG art below.
// Run after changing the art: node scripts/make-icons.mjs
// Uses sharp, which comes with Next.js.
import { mkdir, writeFile } from "node:fs/promises";
import sharp from "sharp";

const SKY = `
  <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#2b1650"/>
    <stop offset="0.6" stop-color="#c2257a"/>
    <stop offset="1" stop-color="#ff9a3c"/>
  </linearGradient>`;

// The setting sun on the horizon, the same art as app/icon.svg.
const SUN = `
  <path d="M14 43a18 18 0 0 1 36 0z" fill="#ffd36b"/>
  <rect x="10" y="45" width="44" height="3" rx="1.5" fill="#fff7ec" opacity="0.9"/>`;

const svg = (body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs>${SKY}</defs>${body}</svg>`;

/** Rounded square, for browsers that show the icon as is. */
const rounded = svg(`<rect width="64" height="64" rx="14" fill="url(#sky)"/>${SUN}`);

/** Full-bleed square with the sun scaled into the middle, for launchers that crop icons to their own shape. */
const fullBleed = (scale) =>
  svg(`<rect width="64" height="64" fill="url(#sky)"/><g transform="translate(32 32) scale(${scale}) translate(-32 -36.5)">${SUN}</g>`);

/** White sun on transparent, for the Android status bar next to a notification. */
const badge = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <path d="M10 42a22 22 0 0 1 44 0z" fill="#fff"/>
  <rect x="4" y="46" width="56" height="5" rx="2.5" fill="#fff"/>
</svg>`;

const icons = [
  { file: "public/icons/icon-192.png", art: rounded, size: 192 },
  { file: "public/icons/icon-512.png", art: rounded, size: 512 },
  // Launchers may crop to a circle: keep the art inside the middle 80% (the maskable safe zone).
  { file: "public/icons/maskable-512.png", art: fullBleed(0.8), size: 512 },
  { file: "public/icons/badge-96.png", art: badge, size: 96 },
  // iOS rounds the corners itself and doesn't want transparency.
  { file: "app/apple-icon.png", art: fullBleed(0.9), size: 180 },
];

await mkdir("public/icons", { recursive: true });
for (const { file, art, size } of icons) {
  const png = await sharp(Buffer.from(art), { density: (72 * size) / 64 })
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toBuffer();
  await writeFile(file, png);
  console.log(`${file} ${size}×${size}`);
}
