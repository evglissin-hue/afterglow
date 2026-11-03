# Afterglow: sunset forecast and spots for London

*Working name · Spec v0.1 · 3 Nov 2026 · Draft for review*

## 1. What it is

A mobile-first web app that answers one question: **"Is tonight's sunset worth going out for, and where should I watch it?"**

It combines three things that other apps keep separate:

1. **Forecast:** a 0–100 score, the likely look ("pastel pink", "fiery orange") and the best time to watch.
2. **Spots:** a map of London sunset spots, highlighting the ones where the sun sets in view *tonight*.
3. **Community log:** public spots and photos, built so a social layer can be added later.

The model is SunSeekr, which shows which London terraces are in sun right now, applied to sunsets.

## 2. Decisions so far

| Topic | Decision |
|---|---|
| Builder | Claude, in this session |
| Platform | Web first: mobile-first, installable to the home screen (PWA) |
| Purpose | Hobby: free tiers only, no monetization |
| Area | London for spots; the forecast works for any location |
| Social in v1 | Public spots and photos; no feed, follows, likes or comments |
| Forecast range | The next sunset only (rolls over to tomorrow after dusk) |
| Alerts | Yes, on the day |
| Sunrise | No |

## 3. User stories

**US1: Find a spot nearby**
- Map and list of spots. The list is sorted by distance from me, or from central London if location is off.
- Filter: "sunset in view tonight".
- Each spot shows a photo, distance, view type, access (e.g. "closes at dusk", "booking needed") and average rating.

**US2: Know if tonight will be pretty**
- Score and label: Poor / Fair / Good / Great / Epic.
- The likely look, and a confidence level (high / medium / low).
- Times: golden hour starts, sunset, **best color window** (usually 5–20 min after sunset, when most people have left), last light.
- A short "why", e.g. "High cloud to catch the light · clear gap toward the sun · clean air".

**US3: See how the season changes things**
- Spot page: which months the sun sets in view from there (e.g. "Oct–Feb"), and a compass showing the open view and tonight's sunset direction.
- Map: a line from the selected spot pointing at tonight's sunset.
- Photos of a spot can be filtered to "around this time of year" (±6 weeks).
- This is a hint, never a filter that hides spots. Spots without direction info still show.

**US4: Add a spot** (signed in)
- Drop a pin or use my location; add a name, description, tags and access info.
- Set the open view: point the phone at the left and right edges of the open horizon (compass), or drag a wedge on a compass rose.
- Size: exact spot / small area (~200 m) / large area (~1 km). This covers areas like a park or a stretch of river.
- Warn if a spot already exists within 100 m.

**US5: Log a sunset with photos** (signed in)
- Spot (suggested from GPS or the photo's location), rating 1–5, color tags, optional note, up to 5 photos.
- Photo time and location are read on the device to prefill the form. Location data is removed before upload.
- The forecast at that moment is saved with the log, so we can measure accuracy later.

**US6: Get an alert**
- Opt in, then choose a minimum score (Good / Great / Epic, default Great) and how early (1, 2 or 3 h before sunset, default 2 h).
- At most one alert a day, decided once at that time. Example: "Great sunset likely tonight (74): fiery orange. Sunset 16:30, best color 16:34–16:48. In view at Waterloo Bridge and Richmond Hill."
- On iPhone, web push only works after "Add to Home Screen" (iOS 16.4+). The app explains this.

**US7: Keep it clean**
- Signed-in users can report a spot, log or photo. Three reports hide it until an admin reviews it.
- Admin page to restore or delete. Users can delete their own content and their account.

## 4. Screens

1. **Tonight** (home): score dial, look, confidence, times, "why", the 3 nearest spots that work tonight, and "be there by" (sunset − 15 min).
2. **Map**: London spot pins (bright = sunset in view tonight, grey = not, outline = unknown), my location, and tonight's sunset line from the selected spot. Tapping a pin opens a bottom sheet.
3. **Spot**: photos (this time of year / all), info and access, a 12-month "in view" strip, a compass with the open view and tonight's sunset line, and logs. Actions: Log a sunset, Directions (Google Maps or Citymapper), Report.
4. **Add spot** (signed in)
5. **Log a sunset** (signed in)
6. **Me**: my spots and logs, alert settings, sign out, delete account
7. **Admin**: report queue (admin only)
8. **About**: how the forecast works, terms, privacy

Look and feel: dark UI with warm sunset gradients, big tap targets, usable one-handed outdoors.

## 5. Forecast model (v1)

### 5.1 Sun timing

Calculated on the device with SunCalc, no API needed: golden hour start (sun at +6°), sunset, last light (civil dusk, −6°), and the sunset direction as a compass bearing.

The **best color window** depends on which clouds will catch the light. High clouds stay lit longest.

| Main cloud layer | Best color while the sun is… |
|---|---|
| High (cirrus) | 1.5°–3.5° below the horizon |
| Mid (altocumulus) | 0.5°–2° below |
| Clear sky | from sunset to 1° below; the pink "Belt of Venus" shows in the east |

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
- Models: `best_match`, plus up to three others (UK Met Office, ECMWF, DWD ICON) to measure agreement. Which of these give all three cloud layers for London is checked at build time.
- Values are interpolated to the middle of the best color window.

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
4. canvas < .1 → **Clean gradient**: "orange horizon; turn around for the pink Belt of Venus"
5. canvas ≥ .75 and gapBlock ≤ .3 → **Whole sky glow**
6. Mostly high cloud and AOD < .2 → **Pastel pink and purple**
7. Mostly mid cloud → **Fiery orange and red**
8. Otherwise → **Golden to pink**

### 5.6 Confidence

Score each model separately and show the median. Spread between models ≤ 15 → High, ≤ 30 → Medium, more → Low. Drop one level if sunset is more than 12 h away.

### 5.7 Getting better over time

- Every log stores the forecast inputs and score at that moment.
- From M3, a daily job also stores the forecast made before sunset.
- After a few weeks: compare forecasts with ratings, tune the config, and add a simple "how we did" page.
- The app says plainly that cloud forecasts can be wrong.

### 5.8 API

`GET /api/forecast?lat=51.507&lon=-0.128`

```json
{
  "sun": { "sunset": "2026-11-03T16:30:00Z", "bearing": 246, "goldenStart": "…", "bestColor": ["…", "…"], "lastLight": "…" },
  "score": 74, "label": "Great", "look": "fiery", "confidence": "medium",
  "why": ["Mid-level cloud to catch the light", "Clear gap toward the sun", "Clean air"],
  "factors": { "canvas": 0.55, "lowOver": 0.1, "gapBlock": 0.15, "aod": 0.12, "visibilityKm": 30, "humidity": 72, "rainNow": 0, "clearing": false },
  "models": { "best_match": 74, "ukmo": 77, "ecmwf": 66 },
  "path": [{ "km": 0, "lat": 51.507, "lon": -0.128, "low": 0.1, "mid": 0.4, "high": 0.3 }]
}
```

Requests are rounded to a ~0.1° grid and cached for 30 minutes, so all of London needs only a few upstream calls an hour.

## 6. Spots and seasons

**Spot fields**
- Name, description, location, size (exact / small area / large area)
- View type: **into the sunset** (you face the sun) or **skyline glow** (you face away and watch the city light up while the sky behind it turns pink, e.g. Primrose Hill, Parliament Hill)
- Open view: a bearing range, e.g. 225°–290° (optional)
- Access: open 24h / closes at dusk / opening hours / booking needed, plus notes. Some London parks lock their gates around dusk, so this matters.
- Tags: river, skyline, hilltop, rooftop, park, free, paid

**In view tonight** means tonight's sunset bearing falls inside the open view (±5°). Glow spots skip this check.

**Months in view** is the same check for every day of the year, summarized. London sunset bearings on the 15th of each month:

| Jan | Feb | Mar | Apr | May | Jun | Jul | Aug | Sep | Oct | Nov | Dec |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 236° | 251° | 268° | 287° | 303° | 311° | 307° | 294° | 276° | 257° | 240° | 232° |

So a spot with an open view of 225°–260° shows "in view mid-Oct to Feb". Seen from Greenwich Park, the City skyline sits at ~300°, so the sun sets behind it only from about May to early August.

**Capturing the open view on the web:** the DeviceOrientation API gives a compass heading (iPhone needs a permission tap). Compasses in the city can be 10–20° off, so the wedge can always be adjusted on the map afterwards.

**Seed data (M1)**
- About 20 hand-picked spots. I'll check each one's location and view direction against OpenStreetMap, and you can edit the list.
  - Bridges and river: Waterloo Bridge, Golden Jubilee Bridges, Millennium Bridge, Hammersmith riverside
  - Hills and parks: Primrose Hill, Parliament Hill, Richmond Hill, King Henry's Mound, Greenwich Park, Alexandra Palace, One Tree Hill, Hilly Fields, Point Hill, Telegraph Hill, Horniman Gardens
  - Free rooftops (booking and hours vary): Sky Garden, Horizon 22, Tate Modern viewing level, One New Change, Garden at 120
- Plus OpenStreetMap viewpoints (`tourism=viewpoint`) in Greater London. Their `direction` tag fills in the open view where present. They show as smaller "unverified" pins until someone logs a sunset there.
- In M1, spots live in a JSON file in the repo. M2 moves them into the database.

## 7. Architecture

```
Phone browser: Next.js app (installable PWA)
  ├─ map: MapLibre GL + OpenFreeMap tiles (free, no key)
  ├─ sun times and directions: SunCalc, on the device
  ├─ data: Supabase (Postgres, Auth, Storage), protected by row-level security
  └─ Next.js API routes on Vercel
       ├─ /api/forecast  → Open-Meteo forecast + air quality, cached
       ├─ /api/logs      → saves a log together with the current forecast
       └─ /api/cron      ← Supabase Cron, every 15 min → web push alerts
```

- **Next.js** (App Router, TypeScript) with Tailwind CSS
- **MapLibre GL JS** with OpenFreeMap tiles (fallback: a free MapTiler key)
- **SunCalc** for sun positions
- **Open-Meteo** Forecast and Air Quality APIs
- **Supabase** free tier: Postgres, Auth (Google sign-in), Storage for photos, row-level security
- **Web Push** (VAPID, `web-push` package). Supabase Cron calls the alert endpoint every 15 minutes.
- **Vercel** Hobby plan (free, non-commercial, which fits a hobby project)
- **Tests:** Vitest for the forecast engine and sun math, Playwright for the main flows

The forecast engine is a pure TypeScript module with no network or database code. It runs on the server and in tests, and could later run in the browser or a native app.

## 8. Data model (Postgres on Supabase)

```
profiles        id (= auth user), display_name, avatar_url, is_admin, created_at
spots           id, slug, name, description, lat, lon, radius_m, view_type, view_from_deg, view_to_deg,
                access, access_notes, tags[], source (curated | osm | user), osm_id, created_by,
                visibility, status (active | hidden), created_at, updated_at
logs            id, user_id, spot_id, lat, lon, observed_at, rating (1–5), color_tags[], note,
                forecast (jsonb snapshot), visibility, status, created_at
photos          id, log_id, spot_id, user_id, path, thumb_path, width, height, taken_at, status, created_at
reports         id, reporter_id, target_type (spot | log | photo), target_id, reason,
                created_at, resolved_at, resolved_by, action
alert_settings  user_id, enabled, min_score, lead_minutes, home_lat, home_lon, last_checked_on
push_subs       id, user_id, endpoint, p256dh, auth, created_at, last_ok_at
forecast_snaps  id, cell, sunset_date, computed_at, lead_minutes, score, look, confidence, inputs (jsonb)
```

- `visibility` exists from day one (always `public` in v1), so private or friends-only can be added later without a migration.
- Nearby search uses a lat/lon bounding box plus a distance sort. At London scale this doesn't need PostGIS.
- Row-level security: anyone can read active public rows, signed-in users write their own, admins moderate.
- Photos: a public bucket, `photos/{user_id}/{photo_id}.webp`. Users can only write to their own folder.

## 9. Photos and privacy

- Photos are resized on the device to max 2048 px, plus a 400 px thumbnail. Re-encoding removes all metadata, including GPS.
- EXIF time and location are read on the device first, only to prefill the log.
- Limits: 5 photos per log, 30 a day per user. Supabase's free 1 GB holds roughly 2,500 photos.
- Location is used on the device. The only stored location is the optional alert home location, rounded to ~1 km.
- Deleting an account removes its logs and photos. Spots it created stay, with no name attached.
- Even a hobby site with public uploads can fall under UK GDPR and the Online Safety Act. The app includes report and takedown, account deletion, and short terms and privacy pages. Ofcom's guidance for small services is worth a skim before inviting strangers.

## 10. Milestones

**M1: Tonight** (no accounts needed)
Forecast engine with tests, `/api/forecast`, Tonight screen, map with seed spots, spot pages with season info, About page. Deployable as is.
*Done when:* score, look and times show for any location; London spots show "in view tonight" correctly for different dates; tests pass (sun times within 2 min of reference values, plus scoring scenarios for clear sky, low overcast, blocked horizon, mid-cloud canvas, haze and rain clearing).

**M2: Contribute**
Supabase, Google sign-in, add a spot (compass + wedge), log a sunset with photos, spot galleries ("this time of year"), reports and admin page, delete account.
*Done when:* on a phone, a signed-in user can add a spot and a log with photos, other people see them, and three reports hide an item.

**M3: Alerts**
Installable PWA (manifest + service worker), push opt-in and settings, and the 15-minute job (send due alerts, save the daily pre-sunset forecast).
*Done when:* a test user gets exactly one alert on a day that clears their threshold, at their chosen time, on Android Chrome and on an iPhone with the app on the home screen.

**Later**
- Tune the score from logs; "how we did" page
- Work out open views automatically from terrain and building heights (the way SunSeekr works out shade)
- Feed, follows, likes, comments; private and friends-only spots
- Travel times (TfL API), multi-day outlook, more cities, sunrise, native app, AR "where will the sun set" camera view

## 11. Risks

- **Forecast accuracy** is the main risk, since the first weights are guesses. Mitigation: show the factors and confidence, log outcomes from day one, tune.
- **Open-Meteo limits:** the free tier is limited per IP, and Vercel shares IPs between customers. Mitigation: grid caching. The engine can move to the browser if needed.
- **Model coverage:** which models give all three cloud layers for London is still to be checked.
- **iPhone push** needs Add to Home Screen.
- **Compass accuracy** in the city: always allow manual adjustment.
- **Free tiers:** Supabase pauses projects after a week without activity (the 15-minute job should keep it awake). OpenFreeMap has no uptime guarantee (fallback: a free MapTiler key).

## 12. What I need from you

- **Now:** review this spec, especially the seed spot list and the alert defaults.
- **Before I build:** allow the Open-Meteo hosts in this environment's network settings, and set up a GitHub repo for the code (details in chat).
- **Before deploying M1:** a free Vercel account connected to that repo.
- **Before M2:** a free Supabase project and a Google sign-in client. I'll write step-by-step instructions when we get there.
