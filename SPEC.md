# Afterglow: sunset forecast and neighborhood spots for London

*Working name · Spec v0.5 · 3 Nov 2026 · M1 and M2 built*

> **v0.5:** M2 is built: about 15,400 spots found across London, a map, "Best near you" and spot pages. The pipeline as built is described in §6.2.
>
> **v0.4:** an Android app is the long-term target, iPhone maybe later (§7.1).
>
> **v0.3:** M1 is built. Forecast details are updated from real data: the three weather models, a longer clear-sky color window, and a rule so a poor score never promises colors. The forecast now runs in the visitor's browser (§5.8).
>
> **v0.2:** the focus moved to neighborhood spots within a short walk, found automatically all over London, each with a computed view toward the sunset (§6).

## 1. What it is

A mobile-first web app that answers one question: **"Is tonight's sunset worth stepping out for, and where's the best place to watch it within a short walk?"**

It combines three things that other apps keep separate:

1. **Forecast:** a 0–100 score, the likely look ("pastel pink", "fiery orange") and the best time to watch.
2. **Neighborhood spots:** the top of the local park, a canal bridge, a playing field with open sky to the west. They're found automatically across London and ranked by how much of tonight's sunset you can see from each, and how far you have to walk.
3. **Community log:** public spots and photos, built so a social layer can be added later.

The model is SunSeekr, which uses building data to work out which terraces are in sun right now. This app uses the same kind of data to work out where you can see the sunset.

## 2. Decisions so far

| Topic | Decision |
|---|---|
| Builder | Claude, in this session |
| Platform | Web first: mobile-first, installable to the home screen (PWA). Android app later; iPhone maybe, if it takes off |
| Purpose | Hobby: free tiers only, no monetization |
| Area | London for spots; the forecast works for any location |
| Spots | Neighborhood spots within a short walk (default 15 min), not destination viewpoints |
| Social in v1 | Public spots and photos; no feed, follows, likes or comments |
| Forecast range | The next sunset only (rolls over to tomorrow after dusk) |
| Alerts | Yes, on the day |
| Sunrise | No |

## 3. User stories

**US1: Find a spot within a short walk**
- Spots within my walking radius (5, 10, 15 or 30 min; default 15), measured from where I am or from a saved home location.
- Ranked for tonight: how open the view is toward tonight's sunset first, then walking time.
- Each spot shows walking time, a "leave by" time, tonight's view (e.g. "open horizon" or "sun hides behind trees at 16:21"), access (e.g. "park closes at dusk") and photos if there are any.
- Walking time is estimated from straight-line distance (× 1.3 for the street network, at 5 km/h), so no routing service is needed. "Leave by" gets you there 10 minutes before sunset.

**US2: Know if tonight will be pretty**
- Score and label: Poor / Fair / Good / Great / Epic.
- The likely look, and a confidence level (high / medium / low).
- Times: golden hour starts, sunset, **best color window** (usually 5–20 min after sunset, when most people have left), last light.
- A short "why", e.g. "High cloud to catch the light · clear gap toward the sun · clean air".

**US3: See how the season changes things**
- Every spot has a view profile: how high buildings, trees and hills rise in each direction between west-southwest and northwest.
- The spot page marks where the sun sets on that profile tonight and across the year, e.g. "Open horizon Oct–Feb. In June the sun drops behind the flats about 25 min before sunset."
- Map: a line from the selected spot pointing at tonight's sunset.
- Photos of a spot can be filtered to "around this time of year" (±6 weeks).
- This is a hint, never a filter that hides spots.

**US4: Add a spot** (signed in)
- For local finds: the bench at the top of the park, a street end that faces the sunset, a footbridge.
- Drop a pin or use my location; add a name, short description, tags and access info.
- Optional: point the phone at the edges of the open view (compass), or drag a wedge on a compass rose. The weekly spot pipeline (§6.2) also computes its view profile.
- Size: exact spot, or a small area (~200 m) such as a field or a stretch of canal.
- Warn if a spot already exists within 50 m.

**US5: Log a sunset with photos** (signed in)
- Spot (suggested from GPS or the photo's location), rating 1–5, color tags, "was the view open?" (yes / partly / blocked), optional note, up to 5 photos.
- Photo time and location are read on the device to prefill the form. Location data is removed before upload.
- The forecast at that moment is saved with the log, so we can measure forecast accuracy later. The view answer checks the computed profile, and the first log turns an auto-found spot into a confirmed one.

**US6: Get an alert**
- Opt in, then choose a minimum score (Good / Great / Epic, default Great) and how early (1, 2 or 3 h before sunset, default 2 h).
- At most one alert a day, decided once at that time. Example: "Great sunset likely tonight (74): fiery orange. Best near you: Hilly Fields, 8 min walk, open horizon. Leave by 16:12."
- On iPhone, web push only works after "Add to Home Screen" (iOS 16.4+). The app explains this.

**US7: Keep it clean**
- Signed-in users can report a spot, log or photo. Three reports hide it until an admin reviews it.
- Admin page to restore or delete. Users can delete their own content and their account.

## 4. Screens

1. **Tonight** (home): score dial, look, confidence, times and "why"; then **Best near you**: the top 3 spots within my walking radius, each with walking time, "leave by" and tonight's view.
2. **Map**: my walking radius as a circle, spot pins colored by tonight's view (open / partly / blocked), and tonight's sunset line from the selected spot. Tapping a pin opens a bottom sheet.
3. **Spot**: photos (this time of year / all), the view profile with tonight's sunset marked, the months with an open view, info and access, and logs. Actions: Log a sunset, Directions (Google Maps or Citymapper), Report.
4. **Add spot** (signed in)
5. **Log a sunset** (signed in)
6. **Me**: home location, walking radius, my spots and logs, alert settings, sign out, delete account
7. **Admin**: report queue (admin only)
8. **About**: how the forecast and spot finding work, terms, privacy

Look and feel: dark UI with warm sunset gradients, big tap targets, usable one-handed outdoors.

## 5. Forecast model (v1)

### 5.1 Sun timing

Calculated on the device with SunCalc, no API needed: golden hour start (sun at +6°), sunset, last light (civil dusk, −6°), and the sunset direction as a compass bearing.

The **best color window** depends on which clouds will catch the light. High clouds stay lit longest.

| Main cloud layer | Best color while the sun is… |
|---|---|
| High (cirrus) | 1.5°–3.5° below the horizon |
| Mid (altocumulus) | 0.5°–2° below |
| Clear sky | from sunset to 3° below; the pink "Belt of Venus" shows in the east |

Computed for London:

| Date | Sunset | Direction | Best color (high cloud) | Last light |
|---|---|---|---|---|
| 21 Dec | 15:53 GMT | 232° (SW) | 15:59–16:14 | 16:34 |
| 20 Mar | 18:13 GMT | 271° (W) | 18:18–18:30 | 18:47 |
| 21 Jun | 21:21 BST | 311° (NW) | 21:27–21:45 | 22:09 |
| 3 Nov (today) | 16:30 GMT | 246° (WSW) | 16:34–16:48 | 17:05 |

The sunset point swings ~80° over the year. The color window is longer near the solstices than near the equinoxes.

### 5.2 Weather data

[Open-Meteo](https://open-meteo.com): free for non-commercial use, no key.

- Forecast API, hourly: `cloud_cover_low`, `cloud_cover_mid`, `cloud_cover_high`, `visibility`, `relative_humidity_2m`, `precipitation`.
- Air Quality API (CAMS), hourly: `aerosol_optical_depth` (haze, smoke, dust).
- Models: UK Met Office (`ukmo_seamless`), ECMWF (`ecmwf_ifs`) and DWD ICON (`icon_seamless`). All three give the three cloud layers for London (checked 3 Nov 2026). `best_match` is the Met Office model for the UK, so it isn't added separately.
- Values are read 10 minutes after sunset, interpolated between hours.

### 5.3 Where to look: along the sunset line

The clouds that light up are overhead and toward the sun. After sunset they're lit by light that skims in from up to ~300 km away in the sunset direction. If low or mid cloud sits on that path, the light never reaches them, even when the sky above you looks perfect.

So we sample 8 points along tonight's sunset bearing (one request per API, multiple coordinates):

```
 east           you                                   toward the sunset →
 -25 km ──────── 0 ──── 25 ──── 50 ──── 100 ──── 150 ──── 200 ──── 300 km
 ├─────────────── canvas ────────────────┤
                                         ├─────── light path ───────┤

 canvas      high + mid cloud here is what lights up
 light path  low + mid cloud here blocks the light on its way to the canvas
```

### 5.4 Score

```
union(a, b) = 1 − (1 − a)(1 − b)    // chance that at least one of two layers is there (0–1)

canvas   = weighted mean of union(high, mid) at −25, 0, 25, 50, 100 km  (weights .10 .35 .25 .20 .10)
lowOver  = mean of low cloud at 0 and 25 km
gapBlock = weighted mean of union(low, mid) at 100, 150, 200, 300 km    (weights .15 .25 .30 .30)

potential = curve(canvas)     0 → .30 · .1 → .45 · .3 → .85 · .4–.7 → 1 · .9 → .85 · 1 → .70
gap       = 1 − .85 · smoothstep(.2, .8, gapBlock)
lowCloud  = 1 − .80 · smoothstep(.4, .9, lowOver)
air       = lowest of:  AOD         ≤ .2 → 1 · .35 → .85 · .5 → .65 · ≥ .8 → .4
                        visibility  ≥ 20 km → 1 · 10 → .85 · 5 → .6 · ≤ 1 → .3
                        humidity    ≤ 80% → 1 · 90% → .85 · ≥ 97% → .7
rain      = rain now ≥ 0.5 mm/h → .4 · ≥ 0.1 → .75 · otherwise 1
clearing  = +8 if ≥ 1 mm fell in the last 6 h, it's dry now and gapBlock < .4

score = clamp(round(100 · potential · gap · lowCloud · air · rain) + clearing, 0, 100)
```

Curves are linear between the listed points. Labels: 0–24 Poor · 25–44 Fair · 45–64 Good · 65–84 Great · 85–100 Epic.

What this gives: clear sky ≈ 30 (Fair, "clean gradient"); half the sky covered in mid or high cloud with a clear path ≈ 100; the same sky with a cloud bank on the path ≈ 15; low overcast < 5.

All numbers are educated first guesses. They live in one config file and get tuned from real logs (5.7).

### 5.5 Likely look

The first rule that matches wins:

1. Raining, or low cloud ≥ 85% overhead → **Grey**: "low cloud will hide it"
2. gapBlock ≥ .75 → **Blocked**: "cloud bank toward the sunset"
3. air < .6 → **Hazy and muted**: "maybe a red sun disc"
4. Score is Poor anyway → whichever of Grey, Blocked or Hazy holds it back most, so a poor score never promises colors
5. canvas < .1 → **Clean gradient**: "orange horizon; turn around for the pink Belt of Venus"
6. canvas ≥ .75 and gapBlock ≤ .3 → **Whole sky glow**
7. Mostly high cloud and AOD < .2 → **Pastel pink and purple**
8. Mostly mid cloud → **Fiery orange and red**
9. Otherwise → **Golden to pink**

### 5.6 Confidence

Score each model separately and show the median. Spread between models ≤ 15 → High, ≤ 30 → Medium, more → Low. Drop one level if sunset is more than 12 h away.

### 5.7 Getting better over time

- Every log stores the forecast inputs and score at that moment.
- From M4, a daily job also stores the forecast made before sunset.
- After a few weeks: compare forecasts with ratings, tune the config, and add a simple "how we did" page.
- The app says plainly that cloud forecasts can be wrong.

### 5.8 Where the forecast runs, and the API

The browser computes the forecast itself, calling Open-Meteo directly, so each visitor uses their own free quota. A shared IP can run out: the build container's did on 3 Nov. If the direct call fails, the browser falls back to `GET /api/forecast?lat=…&lon=…`, which runs the same code on the server and will also serve the alert job (M4). Locations are rounded to a 0.1° grid, and results are cached for 30 minutes (browser storage, and the CDN for the API).

```json
{
  "location": { "lat": 51.5, "lon": -0.1, "timezone": "Europe/London" },
  "sun": {
    "goldenStart": "…", "sunset": "2026-11-03T16:29:54Z", "lastLight": "…", "bearing": 246, "compass": "WSW",
    "bestColor": { "start": "…", "end": "…", "layer": "mid" }
  },
  "score": 7, "label": "Poor", "look": "grey", "lookTitle": "Grey", "lookText": "Low cloud is likely to hide it.",
  "confidence": "medium", "spread": 29,
  "why": [{ "text": "Cloud bank toward the sunset", "tone": "bad" }, { "text": "Clean air", "tone": "good" }],
  "factors": { "canvas": 0.41, "lowOver": 0.88, "gapBlock": 0.61, "aod": 0.07, "visibilityKm": 33, "humidity": 75, "…": "…" },
  "models": [{ "id": "ukmo_seamless", "name": "UK Met Office", "score": 5 }, { "id": "ecmwf_ifs", "name": "ECMWF", "score": 34 }],
  "path": [{ "km": 0, "lat": 51.5, "lon": -0.1, "low": 0.9, "mid": 0.24, "high": 0 }],
  "leadHours": 2.7, "generatedAt": "…"
}
```

## 6. Spots

### 6.1 Where spots come from

1. **Auto-found** (the main source): computed for all of Greater London by the spot pipeline below. They're labeled "auto-found" until someone logs a sunset there.
2. **Added by people**, from M3.
3. **Viewpoints and rooftops** already tagged in OpenStreetMap, for when you do want to go further. These are not the focus.

### 6.2 The spot pipeline

Python in `pipeline/`, documented in `pipeline/README.md`. A full London run takes about 13 minutes; running it weekly in GitHub Actions is a later option.

1. **Height map:** a 5 m grid covering London plus 3 km. Ground height comes from Ordnance Survey Terrain 50. Buildings come from OpenStreetMap (BBBike's London extract), using the height tag, else floors × 3 m, else a typical height for the building type. Woods and tree rows count as 15 m and 12 m, single trees as 12 m.
2. **Candidates:** public places likely to have open sky to the west:
   - a 40 m grid inside parks, commons, playing fields and heaths; the best points tend to be on the east side, looking across
   - paths beside the Thames, canals, reservoirs and lakes, every 30 m
   - bridges and footbridges over water or railways
   - long straight streets that point west
   - OpenStreetMap viewpoints, including rooftops

   Private land, school grounds and golf courses are skipped.
3. **View profile:** from eye height (1.6 m; bridges +1 m; rooftops on top of the building), a ray every 2° from 220° to 320°, out to 3 km, records the highest angle anything rises above the horizon.
4. **Score and thin out:** score how often through the year the sunset is in view, plus how much western sky is open. Keep the best: at most 2 per ~400 m square, and at most 6 per park, 350 m apart.
5. **Output:** JSON tiles of about 5.5 km plus an index, in `public/data/spots/`. The app loads only the tiles near you. M3 moves spots into the database.

### 6.3 Using the view profile

For any date, look up the obstacle angle in the sunset direction:

| Obstacle angle | Label | What you see |
|---|---|---|
| under 2° | Open horizon | The sun sets in view |
| 2°–5° | Low skyline | The sun disappears a few minutes early |
| 5°–12° | Sky view | The sun hides early, but you still see the colors |
| over 12° | Blocked | Not a good spot tonight |

- **Sun hides at:** the moment the sun's height drops below the obstacle angle in its direction.
- Ranking also counts how much sky is open within ±20° of the sunset direction. The best colors come after sunset and high in the sky, so "sky view" spots still work for color.
- **Street henge:** for a street that points west, the two dates a year when the sun sets straight down it, London's own Manhattanhenge. Street spots only show on evenings when the sun sets (nearly) down them.

Sunset direction in London on the 15th of each month:

| Jan | Feb | Mar | Apr | May | Jun | Jul | Aug | Sep | Oct | Nov | Dec |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 236° | 251° | 268° | 287° | 303° | 311° | 307° | 294° | 276° | 257° | 240° | 232° |

So a spot whose view is open from 225° to 260° has an open horizon from mid-October to February. From Greenwich Park the City skyline sits at ~300°, so the sun sets behind it only from about May to early August.

### 6.4 Spot fields

- Name, description, location, size (exact spot / small area)
- Kind: park, water, bridge, street, hill, rooftop, other
- View type: **into the sunset** (you face the sun) or **skyline glow** (you face away and watch the city light up while the sky behind it turns pink)
- View profile (computed) and/or an open-view wedge (entered by a person)
- Access: open 24h / closes at dusk / opening hours / booking needed, from OpenStreetMap `opening_hours` where tagged, plus notes
- Tags: river, canal, skyline, hilltop, field, free, paid

### 6.5 How accurate the pipeline is

- OpenStreetMap has almost all London buildings, but heights for only some, and trees in parks are often missing. Parks may come out looking more open than they are.
- Check: compare 10–20 spots in one neighborhood with reality (yours would be ideal), and use the "was the view open?" answers from logs.
- Upgrade: the Environment Agency's free LIDAR survey (1–2 m) has real building and tree heights for London. It replaces step 1 without changing the rest.

**Capturing an open view by hand:** the DeviceOrientation API gives a compass heading (iPhone needs a permission tap). Compasses in the city can be 10–20° off, so the wedge can always be adjusted on the map afterwards.

## 7. Architecture

```
Phone browser: Next.js app (installable PWA)
  ├─ forecast: computed in the browser from Open-Meteo (falls back to /api/forecast)
  ├─ map: MapLibre GL + OpenFreeMap tiles (free, no key)
  ├─ sun times and directions: SunCalc, on the device
  ├─ data: Supabase (Postgres, Auth, Storage), protected by row-level security
  └─ Next.js API routes on Vercel
       ├─ /api/forecast  → the same forecast on the server: fallback, alert job, debugging
       ├─ /api/logs      → saves a log together with the current forecast
       └─ /api/cron      ← Supabase Cron, every 15 min → web push alerts

Spot pipeline: Python, weekly in GitHub Actions
  OpenStreetMap London extract + OS Terrain 50
    → height map → candidates → view profiles → spots data file (M2) / database (M3+)
```

- **Next.js** (App Router, TypeScript) with Tailwind CSS
- **MapLibre GL JS** with OpenFreeMap tiles (fallback: a free MapTiler key)
- **SunCalc** for sun positions
- **Open-Meteo** Forecast and Air Quality APIs
- **Supabase** free tier: Postgres, Auth (Google sign-in), Storage for photos, row-level security
- **Web Push** (VAPID, `web-push` package). Supabase Cron calls the alert endpoint every 15 minutes.
- **Vercel** Hobby plan (free, non-commercial, which fits a hobby project)
- **Spot pipeline:** Python with numpy, shapely and pyosmium. GitHub Actions' free minutes easily cover a weekly run.
- **Tests:** Vitest for the forecast engine and sun math, pytest for the pipeline, Playwright for the main flows

The forecast engine is a pure TypeScript module with no network or database code. It runs in the browser, on the server and in tests, and can run unchanged in an Android app.

### 7.1 Path to an Android app

Android is the long-term target; iPhone maybe later. To keep the move cheap:

- `lib/` (sun, forecast, weather, geo, spots) stays plain TypeScript with no Next.js, React or browser-only APIs, so a React Native (Expo) app can reuse it as is.
- Spot data is a plain JSON file, and Supabase has an Android SDK, so the data layer carries over.
- MapLibre has native Android and React Native versions.
- Until then, the PWA installs on Android from Chrome, and web push works there without extra steps (unlike iPhone).

When the time comes, there are two routes:

1. **Wrap the PWA for the Play Store** (a Trusted Web Activity): days of work, same app.
2. **Build a native Expo app on `lib/`**: weeks of work, for what the web does badly: a home-screen widget with tonight's score, reliable background alerts, compass and camera views.

Repo layout:

```
app/            Next.js pages and API routes
lib/forecast/   forecast engine (pure TypeScript)
lib/sun/        sun times, directions, "sun hides at"
pipeline/       spot pipeline (Python)
data/           generated spot data
SPEC.md         this document
```

## 8. Data model (Postgres on Supabase)

```
profiles        id (= auth user), display_name, avatar_url, is_admin, created_at
user_settings   user_id, home_lat, home_lon, walk_minutes, alerts_enabled, min_score,
                lead_minutes, last_alert_check_on
spots           id, slug, name, description, lat, lon, radius_m, kind, view_type,
                horizon (51 angles, 220°–320° every 2°), ground_elev_m, eye_height_m,
                view_from_deg, view_to_deg, access, access_notes, tags[],
                source (auto | user | curated), osm_id, created_by, confirmed_at,
                visibility, status (active | hidden), created_at, updated_at
logs            id, user_id, spot_id, lat, lon, observed_at, rating (1–5), color_tags[],
                view_open (yes | partly | blocked), note, forecast (jsonb snapshot),
                visibility, status, created_at
photos          id, log_id, spot_id, user_id, path, thumb_path, width, height, taken_at, status, created_at
reports         id, reporter_id, target_type (spot | log | photo), target_id, reason,
                created_at, resolved_at, resolved_by, action
push_subs       id, user_id, endpoint, p256dh, auth, created_at, last_ok_at
forecast_snaps  id, cell, sunset_date, computed_at, lead_minutes, score, look, confidence, inputs (jsonb)
```

- `visibility` exists from day one (always `public` in v1), so private or friends-only can be added later without a migration.
- Nearby search uses a lat/lon bounding box plus a distance sort. At London scale this doesn't need PostGIS.
- Row-level security: anyone can read active public rows, signed-in users write their own, admins moderate.
- Photos: a public bucket, `photos/{user_id}/{photo_id}.webp`. Users can only write to their own folder.
- Signed-out visitors keep their home location and walking radius on the device only.

## 9. Photos and privacy

- Photos are resized on the device to max 2048 px, plus a 400 px thumbnail. Re-encoding removes all metadata, including GPS.
- EXIF time and location are read on the device first, only to prefill the log.
- Limits: 5 photos per log, 30 a day per user. Supabase's free 1 GB holds roughly 2,500 photos.
- Location is used on the device. The only stored location is the optional home location, rounded to ~1 km.
- Deleting an account removes its logs and photos. Spots it created stay, with no name attached.
- Even a hobby site with public uploads can fall under UK GDPR and the Online Safety Act. The app includes report and takedown, account deletion, and short terms and privacy pages. Ofcom's guidance for small services is worth a skim before inviting strangers.

## 10. Milestones

**M1: Tonight** (no accounts needed) · **Built 3 Nov 2026**
Forecast engine with tests, `/api/forecast`, the forecast part of the Tonight screen, About page. Deployable as is.
*Done when:* score, look and times show for any location, and tests pass (sun times within 2 min of reference values, plus scoring scenarios for clear sky, low overcast, blocked horizon, mid-cloud canvas, haze and rain clearing).

**M2: Spots near you** · **Built 3 Nov 2026; waiting on the Hoxton check**
Spot pipeline, map with walking radius, "Best near you" on the Tonight screen, and spot pages with the view profile.
*Done when:* spots cover all of Greater London, and in the test neighborhood (Hoxton) at least 8 of 10 checked spots match reality (open / partly / blocked).

**M3: Contribute**
Supabase, Google sign-in, add a spot (compass + wedge), log a sunset with photos and the view answer, spot galleries ("this time of year"), reports and admin page, delete account.
*Done when:* on a phone, a signed-in user can add a spot and a log with photos, other people see them, and three reports hide an item.

**M4: Alerts**
Installable PWA (manifest + service worker), push opt-in and settings, and the 15-minute job (send due alerts, save the daily pre-sunset forecast).
*Done when:* a test user gets exactly one alert on a day that clears their threshold, at their chosen time, naming the best spot within their walking radius, on Android Chrome and on an iPhone with the app on the home screen.

**Later**
- Tune the score from logs; "how we did" page
- LIDAR heights for real trees and buildings
- Feed, follows, likes, comments; private spots (e.g. "my balcony")
- Android app (§7.1), then maybe iPhone
- Multi-day outlook, more cities, sunrise, AR "where will the sun set" camera view

## 11. Risks

- **Forecast accuracy** is the main risk, since the first weights are guesses. Mitigation: show the factors and confidence, log outcomes from day one, tune.
- **Spot accuracy:** missing building heights and unmapped trees. Mitigation: check a test neighborhood, use the "was the view open?" answers, move to LIDAR if needed.
- **Open-Meteo limits:** the free tier is limited per IP, and shared IPs run out (the build container's did). Mitigation: the browser fetches with each visitor's own IP, the server is only a fallback, and results are cached. The alert job (M4) may need retries.
- **iPhone push** needs Add to Home Screen.
- **Compass accuracy** in the city: always allow manual adjustment.
- **Free tiers:** Supabase pauses projects after a week without activity (the 15-minute job should keep it awake). OpenFreeMap has no uptime guarantee (fallback: a free MapTiler key).

## 12. What I need from you

- **Done:** network access, the GitHub repo, and the test neighborhood (Hoxton).
- **Now:** check a handful of the spots the app finds near you, against what you know of them.
- **Online:** done, at https://afterglow-evglissin-hue.vercel.app (Vercel project `afterglow`; only the owner's Vercel login can open it for now).
- **To deploy on every push:** connect the GitHub repo in the Vercel project's Git settings.
- **Before M3:** a free Supabase project and a Google sign-in client. I'll write step-by-step instructions when we get there.
