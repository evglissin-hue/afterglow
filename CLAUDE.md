@AGENTS.md

# Afterglow

- Product spec: `SPEC.md`. Update it when a decision changes.
- Commands: `npm run dev`, `npm test`, `npm run lint`, `npm run build`.
- `lib/forecast` stays pure (no network or database code); fetching lives in `lib/weather`.
- Tunable scoring numbers live in `lib/forecast/config.ts`.
- In Claude Code cloud sessions, server-side `fetch` only goes through the egress proxy when started with `NODE_USE_ENV_PROXY=1` (e.g. `NODE_USE_ENV_PROXY=1 npm run dev`). Open-Meteo sometimes rate-limits the shared session IP; tests use recorded responses in `lib/weather/__fixtures__`.
- Don't commit personal data such as home addresses or postcodes.
