@AGENTS.md

# Afterglow

- Product spec: `SPEC.md`. Update it when a decision changes.
- Workflow: commit to `main` and push right away (the owner's preference). No long-lived branches or pull requests.
- An Android app is the long-term target: keep `lib/` free of Next.js, React and browser-only APIs so a React Native app can reuse it.
- Commands: `npm run dev`, `npm test`, `npm run lint`, `npm run build`.
- Hosting: Vercel project `afterglow`, production at https://afterglow-evglissin-hue.vercel.app (Vercel Authentication on, so only the owner can open it). Until the GitHub repo is connected in Vercel, deploy after pushing with `npx vercel deploy --prod --yes` (needs `vercel login`, approved by the owner).
- `lib/forecast` stays pure (no network or database code); fetching lives in `lib/weather`.
- Tunable scoring numbers live in `lib/forecast/config.ts`.
- In Claude Code cloud sessions, server-side `fetch` only goes through the egress proxy when started with `NODE_USE_ENV_PROXY=1` (e.g. `NODE_USE_ENV_PROXY=1 npm run dev`). Open-Meteo sometimes rate-limits the shared session IP; tests use recorded responses in `lib/weather/__fixtures__`.
- Don't commit personal data such as home addresses or postcodes.
