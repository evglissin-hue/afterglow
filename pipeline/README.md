# Spot pipeline

Finds sunset spots across London and writes them to `public/data/spots/` for the app. See SPEC.md §6.

## How it works

1. **Height map:** a 5 m grid of ground height (Ordnance Survey Terrain 50) plus buildings and trees from OpenStreetMap. Buildings use their `height` tag, else floors × 3 m, else a typical height for the building type. Woods and tree rows count as 15 m and 12 m, single trees as 12 m.
2. **Candidates:** public places likely to have open sky to the west: a 40 m grid inside parks and open spaces, paths beside water every 30 m, bridges over water or railways, long straight streets pointing west, and OpenStreetMap viewpoints.
3. **View profile:** from eye height, a ray every 2° from 220° to 320° out to 3 km records the highest angle anything rises above the horizon.
4. **Score:** how often through the year the sunset bearing is clear (under 2° is open, under 5° low, under 12° sky view), plus how much western sky is open. Streets only count if you can see straight down them.
5. **Thin and name:** the best spots first, at most 2 per 400 m square, at most 6 per park and 350 m apart. Names come from the park, water or street, plus the nearest street when a park has several spots.
6. **Export:** one JSON file per ~5.5 km tile plus `index.json`, so the app only loads the tiles near you.

## Run it

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt

# Data (about 360 MB, not in git)
mkdir -p raw work
curl -L -o raw/London.osm.pbf https://download.bbbike.org/osm/bbbike/London/London.osm.pbf
curl -L -o raw/terrain50.zip "https://api.os.uk/downloads/v1/products/Terrain50/downloads?area=GB&format=ASCII+Grid+and+GML+%28Grid%29&redirect"

.venv/bin/python -I osm_extract.py raw/London.osm.pbf work/osm.pkl   # ~2 min
.venv/bin/python -I build_spots.py hoxton                            # test area, ~30 s
.venv/bin/python -I build_spots.py london                            # everything, ~11 min, ~6 GB RAM
.venv/bin/python -I build_spots.py london --reuse                    # re-rank and re-name only, ~1 min

.venv/bin/python -m pytest -q
```

`build_spots.py` replaces everything in `public/data/spots/`, so run `london` last.

## Data and licences

- OpenStreetMap data © OpenStreetMap contributors, ODbL. Extract from BBBike.
- OS Terrain 50 © Crown copyright and database right, Open Government Licence.

## Known limits

- OpenStreetMap has nearly all London buildings but heights for only some, and many park trees aren't mapped, so some parks look more open than they are.
- Terrain 50 is a 50 m grid, so canal and railway cuttings are smoothed out.
- The Environment Agency's free 1 m LIDAR has real building and tree heights; swapping it in for step 1 is the planned upgrade.
