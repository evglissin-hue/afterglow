import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // The alert job reads spot tiles from disk (app/_server/alerts/spots.ts); ship them with it.
  outputFileTracingIncludes: {
    "/api/cron/alerts": ["./public/data/spots/**/*.json"],
  },
  async headers() {
    return [
      {
        // Phones check for a new service worker on every visit, so app updates arrive right away.
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
        ],
      },
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
