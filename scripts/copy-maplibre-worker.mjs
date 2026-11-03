// MapLibre runs its tile work in a web worker. Next.js can't bundle that worker,
// so serve the prebuilt one from /public and point MapLibre at it (see SpotMap.tsx).
import { copyFileSync, mkdirSync } from "node:fs";

mkdirSync("public/maplibre", { recursive: true });
copyFileSync("node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs", "public/maplibre/maplibre-gl-worker.mjs");
