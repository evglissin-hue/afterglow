"""Pull what the spot pipeline needs out of an OpenStreetMap extract, projected to British National Grid."""

from __future__ import annotations

import os
import pickle
import re
import sys
import time
from dataclasses import dataclass, field

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # run with python -I

import numpy as np  # noqa: E402
import osmium  # noqa: E402
import shapely  # noqa: E402

from common import TO_BNG, project  # noqa: E402

KEYS = ("building", "natural", "leisure", "landuse", "waterway", "water", "highway", "tourism", "railway", "amenity")

# Typical heights (m) when a building has no height or levels tag.
BUILDING_DEFAULT_M = {
    "house": 8, "detached": 8, "semidetached_house": 8, "terrace": 9, "residential": 9, "bungalow": 5,
    "apartments": 15, "flats": 15, "commercial": 12, "office": 14, "retail": 9, "supermarket": 8,
    "industrial": 9, "warehouse": 9, "church": 15, "cathedral": 25, "school": 10, "university": 14,
    "college": 12, "hospital": 15, "hotel": 15, "garage": 3, "garages": 3, "shed": 3, "carport": 3,
    "hut": 3, "kiosk": 3, "roof": 4, "greenhouse": 3, "static_caravan": 3, "service": 4, "toilets": 3,
}
DEFAULT_BUILDING_M = 9.0

OPEN_SPACE = {
    "leisure": {"park", "common", "recreation_ground", "nature_reserve", "garden", "pitch", "dog_park"},
    "landuse": {"recreation_ground", "village_green", "grass", "meadow"},
    "natural": {"heath", "grassland"},
}
WALKABLE = {
    "footway", "path", "cycleway", "pedestrian", "bridleway", "track", "steps", "living_street",
    "residential", "unclassified", "service", "tertiary", "secondary", "primary", "trunk",
}
NO_ACCESS = {"private", "no", "customers"}
SCHOOLS = {"school", "college", "university", "kindergarten"}

_LENGTH = re.compile(r"^\s*([0-9]+(?:[.,][0-9]+)?)\s*(m|metres|meters|ft|')?\s*$", re.I)


def parse_length_m(value: str | None) -> float | None:
    match = _LENGTH.match(value or "")
    if not match:
        return None
    number = float(match.group(1).replace(",", "."))
    return number * 0.3048 if (match.group(2) or "").lower() in ("ft", "'") else number


def building_height(tags) -> float:
    height = parse_length_m(tags.get("height"))
    if height and 1 <= height <= 400:
        return height
    levels = parse_length_m((tags.get("building:levels") or "").split(";")[0])
    if levels and 0 < levels < 120:
        roof = parse_length_m(tags.get("roof:levels")) or 0
        return (levels + roof) * 3.0 + 1.0
    return float(BUILDING_DEFAULT_M.get(tags.get("building"), DEFAULT_BUILDING_M))


@dataclass
class Layer:
    wkb: list = field(default_factory=list)
    attrs: list = field(default_factory=list)

    def add(self, wkb: str, attrs) -> None:
        self.wkb.append(wkb)
        self.attrs.append(attrs)


LAYERS = ("buildings", "woods", "tree_rows", "open_spaces", "water", "waterways", "schools", "paths", "railways")


def extract(pbf: str) -> dict:
    factory = osmium.geom.WKBFactory()
    layers = {name: Layer() for name in LAYERS}
    trees: list[tuple[float, float]] = []
    viewpoints: list[tuple[float, float, str | None, str | None]] = []
    skipped = 0

    processor = (
        osmium.FileProcessor(pbf)
        .with_locations()
        .with_areas()
        .with_filter(osmium.filter.KeyFilter(*KEYS))
    )
    for obj in processor:
        kind = obj.type_str()
        tags = obj.tags
        try:
            if kind == "a":
                _area(obj, tags, factory, layers)
            elif kind == "w":
                _way(obj, tags, factory, layers)
            elif kind == "n":
                if tags.get("natural") == "tree":
                    trees.append((obj.location.lon, obj.location.lat))
                elif tags.get("tourism") == "viewpoint":
                    viewpoints.append((obj.location.lon, obj.location.lat, tags.get("name"), tags.get("direction")))
        except Exception:  # broken geometry at the extract's edge, or invalid polygons
            skipped += 1

    result = {name: (_to_bng(layer.wkb), layer.attrs) for name, layer in layers.items()}
    tx, ty = TO_BNG.transform([t[0] for t in trees], [t[1] for t in trees])
    result["trees"] = np.column_stack([tx, ty]) if trees else np.empty((0, 2))
    vx, vy = TO_BNG.transform([v[0] for v in viewpoints], [v[1] for v in viewpoints])
    result["viewpoints"] = [
        (x, y, name, direction) for x, y, (_, _, name, direction) in zip(vx, vy, viewpoints)
    ]
    result["skipped"] = skipped
    return result


def _area(obj, tags, factory, layers) -> None:
    building = tags.get("building")
    if building and building != "no":
        layers["buildings"].add(factory.create_multipolygon(obj), building_height(tags))
        return
    natural, landuse, leisure = tags.get("natural"), tags.get("landuse"), tags.get("leisure")
    if natural == "wood" or landuse == "forest":
        layers["woods"].add(factory.create_multipolygon(obj), None)
        return
    if natural == "water" or tags.get("waterway") in ("riverbank", "dock") or landuse in ("reservoir", "basin"):
        layers["water"].add(factory.create_multipolygon(obj), {"name": tags.get("name")})
        return
    if tags.get("amenity") in SCHOOLS:
        layers["schools"].add(factory.create_multipolygon(obj), None)
        return
    if leisure == "golf_course" or tags.get("access") in NO_ACCESS:
        return
    for key, values in OPEN_SPACE.items():
        value = tags.get(key)
        if value in values:
            layers["open_spaces"].add(
                factory.create_multipolygon(obj),
                {
                    "name": tags.get("name"),
                    "tag": f"{key}={value}",
                    "hours": tags.get("opening_hours"),
                    "osm": f"{'w' if obj.from_way() else 'r'}{obj.orig_id()}",
                },
            )
            return


def _way(obj, tags, factory, layers) -> None:
    highway = tags.get("highway")
    if highway in WALKABLE:
        if tags.get("access") in NO_ACCESS or tags.get("tunnel") not in (None, "no"):
            return
        layers["paths"].add(
            factory.create_linestring(obj),
            {
                "highway": highway,
                "name": tags.get("name") or tags.get("bridge:name"),
                "bridge": tags.get("bridge") not in (None, "no"),
            },
        )
        return
    waterway = tags.get("waterway")
    if waterway in ("river", "canal"):
        layers["waterways"].add(factory.create_linestring(obj), {"name": tags.get("name"), "type": waterway})
    elif tags.get("natural") == "tree_row":
        layers["tree_rows"].add(factory.create_linestring(obj), None)
    elif tags.get("railway") in ("rail", "light_rail", "narrow_gauge") and tags.get("tunnel") in (None, "no"):
        layers["railways"].add(factory.create_linestring(obj), None)


def _to_bng(wkb: list[str]) -> np.ndarray:
    if not wkb:
        return np.empty(0, dtype=object)
    geoms = shapely.from_wkb(np.array(wkb, dtype=object))
    return shapely.transform(geoms, project)


if __name__ == "__main__":
    source, target = sys.argv[1], sys.argv[2]
    started = time.time()
    data = extract(source)
    with open(target, "wb") as f:
        pickle.dump(data, f, protocol=pickle.HIGHEST_PROTOCOL)
    counts = {k: len(v[0]) if isinstance(v, tuple) else len(v) for k, v in data.items() if k != "skipped"}
    print(f"extracted in {time.time() - started:.0f}s: {counts}, skipped {data['skipped']}")
