"""Find sunset spots for an area and export them for the app.

    .venv/bin/python -I build_spots.py hoxton      # quick test area
    .venv/bin/python -I build_spots.py london      # everything; writes public/data/spots.json

Needs work/osm.pkl (from osm_extract.py) and raw/terrain50.zip (OS Terrain 50, ASCII grid).
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # run with python -I

import hashlib  # noqa: E402
import json  # noqa: E402
import pickle  # noqa: E402
import re  # noqa: E402
import time  # noqa: E402
from collections import defaultdict  # noqa: E402
from datetime import date  # noqa: E402
from pathlib import Path  # noqa: E402

import numpy as np  # noqa: E402
import shapely  # noqa: E402

from candidates import find_candidates  # noqa: E402
from common import BEARINGS, CELL_M, EYE_M, RAY_M, TO_WGS, area_bng, sunset_bearings  # noqa: E402
from heightmap import build_heightmap  # noqa: E402
from profiles import horizon_profiles, obstacle_at  # noqa: E402
from terrain import load_terrain  # noqa: E402

HERE = Path(__file__).resolve().parent
APP_DATA_DIR = HERE.parent / "public" / "data" / "spots"
# The app loads only the tiles near you. Roughly 5.5 km square in London.
TILE_LAT_DEG = 0.05
TILE_LON_DEG = 0.08

# How good a view is, by obstacle angle toward the sunset (degrees above the horizon).
QUALITY = ((2.0, 1.0), (5.0, 0.75), (12.0, 0.35))
MIN_SCORE = 40
# In dense areas with nothing better, a square still gets its best spot down to this score:
# a sky view nearby beats a good view half an hour away.
LOCAL_MIN_SCORE = 25
STREET_MAX_OBSTACLE = 3.0
THIN_CELL_M = 400.0
PER_CELL = 2
MIN_GAP_M = 120.0
SAME_PLACE_GAP_M = 350.0  # spots in one park or along one canal sit at least this far apart
MAX_PER_PARK = 6
COMPASS = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"]


def quality(angle: np.ndarray) -> np.ndarray:
    return np.select([angle < limit for limit, _ in QUALITY], [q for _, q in QUALITY], 0.0)


def score_profiles(profiles: np.ndarray, kinds: np.ndarray, street_bearings: np.ndarray) -> np.ndarray:
    """0-100: how often through the year the sunset is in view, plus how much western sky is open."""
    year = quality(obstacle_at(profiles, sunset_bearings())).mean(axis=1)
    sky = np.clip((15.0 - profiles[:, 3:48]) / 15.0, 0, 1).mean(axis=1)  # 226°–314°
    score = np.round(100 * (0.6 * year + 0.4 * sky))
    for i in np.nonzero(kinds == "street")[0]:
        # A street is only worth it if you can see straight down it to the horizon.
        along = obstacle_at(profiles[i : i + 1], np.array([street_bearings[i]]))[0, 0]
        score[i] = max(score[i], 50) if along < STREET_MAX_OBSTACLE else 0
    return score.astype(int)


def thin(x: np.ndarray, y: np.ndarray, score: np.ndarray, group: np.ndarray) -> np.ndarray:
    """Best spots first: at most PER_CELL per square, none closer than MIN_GAP_M, and spots of the
    same place (park, canal) at least SAME_PLACE_GAP_M apart, with at most MAX_PER_PARK per park.
    Spots scoring LOCAL_MIN_SCORE to MIN_SCORE only fill squares that have nothing better."""
    cells: dict[tuple[int, int], list[int]] = defaultdict(list)
    by_group: dict[str, list[int]] = defaultdict(list)
    kept = []
    for i in np.argsort(-score, kind="stable"):
        if score[i] < LOCAL_MIN_SCORE:
            break
        cx, cy = int(x[i] // THIN_CELL_M), int(y[i] // THIN_CELL_M)
        if len(cells[(cx, cy)]) >= (PER_CELL if score[i] >= MIN_SCORE else 1):
            continue
        neighbours = (j for dx in (-1, 0, 1) for dy in (-1, 0, 1) for j in cells[(cx + dx, cy + dy)])
        if any((x[j] - x[i]) ** 2 + (y[j] - y[i]) ** 2 < MIN_GAP_M**2 for j in neighbours):
            continue
        siblings = by_group[group[i]]
        if str(group[i]).startswith("park:") and len(siblings) >= MAX_PER_PARK:
            continue
        if any((x[j] - x[i]) ** 2 + (y[j] - y[i]) ** 2 < SAME_PLACE_GAP_M**2 for j in siblings):
            continue
        cells[(cx, cy)].append(i)
        siblings.append(i)
        kept.append(i)
    return np.array(kept, dtype=np.int64)


def access_of(hours: str | None) -> str | None:
    if not hours:
        return None
    return "dusk" if re.search(r"dusk|sunset", hours, re.I) else "hours"


def clean_water_name(name: str | None) -> str | None:
    """'Islington Tunnel (Regent's Canal)' -> "Regent's Canal"."""
    match = re.match(r"^(.*)\((.*(?:Canal|River|Basin|Dock|Navigation).*)\)\s*$", name or "")
    return match.group(2).strip() if match else name


def name_spots(c: dict, idx: np.ndarray, osm: dict) -> list[str]:
    paths, attrs = osm["paths"]
    named = np.array([bool(a["name"]) and a["highway"] not in ("footway", "path", "cycleway") for a in attrs])
    streets = shapely.STRtree(paths[named])
    street_names = [a["name"] for a, ok in zip(attrs, named) if ok]
    # One street per spot: with all_matches (the default) ties return extra rows and misalign names.
    pairs = streets.query_nearest(shapely.points(c["x"][idx], c["y"][idx]), all_matches=False)
    nearest = np.empty(len(idx), dtype=np.int64)
    nearest[pairs[0]] = pairs[1]

    names = []
    for n, i in enumerate(idx):
        place, kind, street = c["name"][i], c["kind"][i], street_names[nearest[n]]
        if kind == "park":
            names.append(place or f"Green space off {street}")
        elif kind == "water":
            place = clean_water_name(place)
            names.append(f"{place} by {street}" if place else f"Waterside by {street}")
        elif kind in ("viewpoint", "rooftop"):
            names.append(place or f"Viewpoint off {street}")
        elif kind == "bridge" and place.startswith(("Footbridge over", "Bridge over")):
            place = place.replace("over the water", "over water")
            names.append(f"{clean_water_name(place)} off {street}")
        else:
            names.append(place)

    # Several spots in one park: say which street each is near.
    groups: dict[str, list[int]] = defaultdict(list)
    for n, name in enumerate(names):
        groups[name].append(n)
    for name, members in groups.items():
        if len(members) > 1 and c["kind"][idx[members[0]]] == "park" and c["name"][idx[members[0]]]:
            for n in members:
                names[n] = f"{name}, by {street_names[nearest[n]]}"

    # Still the same name: add which side of the place each one is on.
    groups = defaultdict(list)
    for n, name in enumerate(names):
        groups[name].append(n)
    for members in groups.values():
        if len(members) < 2:
            continue
        mx = np.mean([c["x"][idx[n]] for n in members])
        my = np.mean([c["y"][idx[n]] for n in members])
        for n in members:
            dx, dy = c["x"][idx[n]] - mx, c["y"][idx[n]] - my
            side = COMPASS[int(round((np.degrees(np.arctan2(dx, dy)) % 360) / 45)) % 8]
            names[n] = f"{names[n]} ({side} side)"
    return names


def months_in_view(profile: np.ndarray) -> str:
    """Which months the sunset is in view or low (obstacle under 5 degrees), e.g. 'Oct–Feb'."""
    days = sunset_bearings()
    angles = obstacle_at(profile[None, :], days)[0]
    month_of_day = np.array([date.fromordinal(date(2027, 1, 1).toordinal() + d).month for d in range(len(days))])
    good = [np.mean(angles[month_of_day == m] < 5.0) >= 0.5 for m in range(1, 13)]
    labels = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split()
    return "".join("■" if g else "·" for g in good) + "  " + ", ".join(l for l, g in zip(labels, good) if g)


def write_tiles(spots: list[dict], area_name: str) -> int:
    """public/data/spots/index.json plus one file per tile; returns total bytes written."""
    tiles: dict[str, list[dict]] = defaultdict(list)
    for spot in spots:
        key = f"{int(np.floor(spot['lat'] / TILE_LAT_DEG))}_{int(np.floor(spot['lon'] / TILE_LON_DEG))}"
        tiles[key].append(spot)

    if APP_DATA_DIR.exists():
        for old in APP_DATA_DIR.glob("*.json"):
            old.unlink()
    APP_DATA_DIR.mkdir(parents=True, exist_ok=True)
    total = 0
    for key, members in tiles.items():
        path = APP_DATA_DIR / f"{key}.json"
        path.write_text(json.dumps({"spots": members}, separators=(",", ":"), ensure_ascii=False))
        total += path.stat().st_size
    index = {
        "version": 1,
        "area": area_name,
        "generated": date.today().isoformat(),
        "profile": {"from": int(BEARINGS[0]), "step": int(BEARINGS[1] - BEARINGS[0]), "count": len(BEARINGS)},
        "tile": {"lat": TILE_LAT_DEG, "lon": TILE_LON_DEG},
        "tiles": {key: len(members) for key, members in sorted(tiles.items())},
    }
    (APP_DATA_DIR / "index.json").write_text(json.dumps(index, separators=(",", ":")))
    return total


def compute_profiles(area_name: str, osm: dict, started: float) -> dict:
    """The slow part: height map, candidates and their view profiles."""
    area = shapely.box(*area_bng(area_name))
    bbox = area_bng(area_name, margin=RAY_M + 100)

    terrain = load_terrain(str(HERE / "raw" / "terrain50.zip"), bbox)
    hm = build_heightmap(bbox, CELL_M, terrain, osm)
    print(f"height map {hm.shape} in {time.time() - started:.0f}s", flush=True)

    c = find_candidates(osm, area)
    kinds = c["kind"]
    on_roof = hm.sample(hm.buildings, c["x"], c["y"])
    usable = (kinds == "viewpoint") | (on_roof <= 0)  # nobody stands inside a building
    c = {k: v[usable] for k, v in c.items()}
    kinds = c["kind"]
    roof = np.where(kinds == "viewpoint", hm.sample(hm.buildings, c["x"], c["y"]), 0.0)
    c["kind"] = kinds = np.where(roof > 0, "rooftop", kinds).astype(object)
    ground = terrain.at(c["x"], c["y"])
    eye = ground + roof + EYE_M + c["eye_extra"]
    counts = {k: int((kinds == k).sum()) for k in np.unique(kinds)}
    print(f"{len(kinds)} candidates {counts} after {time.time() - started:.0f}s", flush=True)

    profiles = horizon_profiles(hm, c["x"], c["y"], eye)
    print(f"profiles in {time.time() - started:.0f}s", flush=True)
    return {"c": c, "ground": ground, "eye": eye, "profiles": profiles}


def main(area_name: str, reuse: bool = False) -> None:
    started = time.time()
    with open(HERE / "work" / "osm.pkl", "rb") as f:
        osm = pickle.load(f)

    cache = HERE / "work" / f"profiles-{area_name}.pkl"
    if reuse and cache.exists():
        with open(cache, "rb") as f:
            computed = pickle.load(f)
        print(f"reusing {cache.name}", flush=True)
    else:
        computed = compute_profiles(area_name, osm, started)
        with open(cache, "wb") as f:
            pickle.dump(computed, f, protocol=pickle.HIGHEST_PROTOCOL)
    c, ground, eye, profiles = computed["c"], computed["ground"], computed["eye"], computed["profiles"]
    kinds = c["kind"]
    score = score_profiles(profiles, kinds, c["street_bearing"])

    keep = thin(c["x"], c["y"], score, c["group"])
    names = name_spots(c, keep, osm)
    lon, lat = TO_WGS.transform(c["x"][keep], c["y"][keep])

    spots = []
    for n, i in enumerate(keep):
        kind = str(kinds[i])
        spot = {
            "id": hashlib.sha1(f"{kind}:{round(c['x'][i])}:{round(c['y'][i])}".encode()).hexdigest()[:8],
            "name": names[n],
            "kind": kind,
            "lat": round(float(lat[n]), 5),
            "lon": round(float(lon[n]), 5),
            "score": int(score[i]),
            "h": [int(round(float(a) * 10)) for a in profiles[i]],
        }
        if kind == "street":
            spot["sb"] = float(c["street_bearing"][i])
        if access := access_of(c["hours"][i]):
            spot["access"] = access
            spot["hours"] = c["hours"][i]
        if eye[i] - ground[i] > EYE_M + 0.5:
            spot["eye"] = round(float(eye[i] - ground[i]), 1)
        spots.append(spot)

    (HERE / "work" / f"spots-{area_name}.json").write_text(json.dumps({"spots": spots}, ensure_ascii=False))
    size = write_tiles(spots, area_name)
    print(f"{len(spots)} spots -> {APP_DATA_DIR} ({size // 1024} KB) in {time.time() - started:.0f}s")

    by_kind = {k: sum(s["kind"] == k for s in spots) for k in sorted({s["kind"] for s in spots})}
    print("by kind:", by_kind)
    print(f"\n{'score':>5}  {'kind':9} {'name':52} months in view (obstacle < 5°)")
    for n in np.argsort([-s["score"] for s in spots])[:25]:
        s = spots[n]
        print(f"{s['score']:>5}  {s['kind']:9} {s['name'][:52]:52} {months_in_view(np.array(s['h']) / 10)}")


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    main(args[0] if args else "hoxton", reuse="--reuse" in sys.argv)
