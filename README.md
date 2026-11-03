# Afterglow

Sunset forecast and neighborhood sunset spots for London. A hobby project; the plan lives in [SPEC.md](SPEC.md).

**Status:** M1 is built: tonight's forecast. Spots near you, contributions and alerts come next.

## What it does now

Scores tonight's sunset from 0 to 100 using cloud forecasts at 8 points along the line toward the sunset. It shows the likely look ("pastel pink", "fiery orange", "grey"), the best color window and a confidence level based on how much three weather models agree.

## Run it

```bash
npm install
npm run dev      # http://localhost:3000
npm test         # unit tests (Vitest)
npm run lint
npm run build
```

## How it's put together

- `lib/sun`: sun times, best color windows and sunset direction (SunCalc)
- `lib/forecast`: the scoring engine. Pure functions; every tunable number is in `config.ts`
- `lib/weather`: Open-Meteo requests and parsing, with recorded responses for tests
- `app/`: the Next.js pages and the `/api/forecast` route

The browser fetches weather straight from Open-Meteo, so each visitor uses their own free quota. `/api/forecast` runs the same code on the server as a fallback, and will serve the alert job later.

## Data

Weather from [Open-Meteo](https://open-meteo.com) (CC BY 4.0), using UK Met Office, ECMWF and DWD ICON models. Air quality from the Copernicus Atmosphere Monitoring Service via Open-Meteo. Open-Meteo's free API is for non-commercial use.
