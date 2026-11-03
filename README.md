# Afterglow

Sunset forecast and neighborhood sunset spots for London. A hobby project; the plan lives in [SPEC.md](SPEC.md).

**Status:** M1 (tonight's forecast) and M2 (spots near you) are built. Contributions and alerts come next.

**Live:** https://afterglow-evglissin-hue.vercel.app (on Vercel; sign in with the owner's Vercel account to open it).

## What it does now

- Scores tonight's sunset from 0 to 100 using cloud forecasts at 8 points along the line toward the sunset. It shows the likely look ("pastel pink", "fiery orange", "grey"), the best color window and a confidence level based on how much three weather models agree.
- Lists the best spots within a short walk and shows them on a map, colored by tonight's view toward the sunset. About 15,400 spots across London were found automatically from map and terrain data (see `pipeline/`).
- Each spot has a page with what's in the way toward the sunset, the sun's path tonight, and which months the sunset is in view.
- Installs to the home screen as an app (Chrome: "Install"; iPhone: Share → Add to Home Screen). Without a signal it opens with the last saved forecast.

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
- `lib/spots`: tonight's view from a spot, when the sun hides, walking times, ranking, tile loading
- `app/`: the Next.js pages and the `/api/forecast` route
- `public/sw.js` and `public/manifest.webmanifest`: the installable app. Icons come from `scripts/make-icons.mjs`
- `pipeline/`: the Python job that finds spots and writes `public/data/spots/` (see its README)

The browser fetches weather straight from Open-Meteo, so each visitor uses their own free quota. `/api/forecast` runs the same code on the server as a fallback, and will serve the alert job later.

## Data

Weather from [Open-Meteo](https://open-meteo.com) (CC BY 4.0), using UK Met Office, ECMWF and DWD ICON models. Air quality from the Copernicus Atmosphere Monitoring Service via Open-Meteo. Open-Meteo's free API is for non-commercial use.

Map data © OpenStreetMap contributors (ODbL); map tiles by [OpenFreeMap](https://openfreemap.org). Contains OS data © Crown copyright and database right 2026 (Open Government Licence).
