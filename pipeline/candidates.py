"""Candidate viewing points: public places likely to have open sky toward the sunset."""

from __future__ import annotations

import math
from collections import defaultdict
from dataclasses import dataclass, field

import numpy as np
import shapely

from common import BRIDGE_EYE_EXTRA_M

OPEN_SPACE_SPACING_M = 40.0
MIN_OPEN_SPACE_M2 = 2_000.0
MIN_GRASS_M2 = 5_000.0
WATER_PATH_SPACING_M = 30.0
WATER_NEAR_M = 25.0
STREET_MIN_RUN_M = 250.0
STREET_STRAIGHT_DEG = 4.0
STREET_HIGHWAYS = {"residential", "unclassified", "tertiary", "secondary", "primary", "living_street", "pedestrian"}
FOOT_HIGHWAYS = {"footway", "path", "cycleway", "pedestrian", "bridleway", "steps", "track"}


@dataclass
class Candidates:
    x: list = field(default_factory=list)
    y: list = field(default_factory=list)
    kind: list = field(default_factory=list)  # park | water | bridge | street | viewpoint
    name: list = field(default_factory=list)  # the place it belongs to, if named
    group: list = field(default_factory=list)  # feature key, to tell spots of one place apart
    eye_extra: list = field(default_factory=list)
    street_bearing: list = field(default_factory=list)
    hours: list = field(default_factory=list)

    def add(self, x, y, kind, name, group, eye_extra=0.0, street_bearing=np.nan, hours=None) -> None:
        self.x.append(float(x))
        self.y.append(float(y))
        self.kind.append(kind)
        self.name.append(name)
        self.group.append(group)
        self.eye_extra.append(eye_extra)
        self.street_bearing.append(street_bearing)
        self.hours.append(hours)

    def arrays(self) -> dict[str, np.ndarray]:
        return {
            "x": np.array(self.x),
            "y": np.array(self.y),
            "kind": np.array(self.kind, dtype=object),
            "name": np.array(self.name, dtype=object),
            "group": np.array(self.group, dtype=object),
            "eye_extra": np.array(self.eye_extra),
            "street_bearing": np.array(self.street_bearing, dtype=np.float64),
            "hours": np.array(self.hours, dtype=object),
        }


def find_candidates(osm: dict, area: shapely.Polygon) -> dict[str, np.ndarray]:
    out = Candidates()
    _open_spaces(osm, area, out)
    _waterside(osm, area, out)
    _bridges(osm, area, out)
    _streets(osm, area, out)
    _viewpoints(osm, area, out)
    return out.arrays()


def _open_spaces(osm, area, out: Candidates) -> None:
    geoms, attrs = osm["open_spaces"]
    schools = shapely.STRtree(osm["schools"][0])
    water = shapely.STRtree(osm["water"][0])
    step = OPEN_SPACE_SPACING_M
    for i in np.nonzero(shapely.intersects(geoms, area))[0]:
        polygon, info = geoms[i], attrs[i]
        grassy = info["tag"] in ("landuse=grass", "landuse=meadow", "leisure=pitch")
        if polygon.area < (MIN_GRASS_M2 if grassy else MIN_OPEN_SPACE_M2):
            continue
        if grassy and len(schools.query(polygon.representative_point(), predicate="within")):
            continue  # school playing fields
        minx, miny, maxx, maxy = polygon.bounds
        gx = np.arange(math.floor(minx / step) * step + step / 2, maxx, step)
        gy = np.arange(math.floor(miny / step) * step + step / 2, maxy, step)
        xs, ys = (a.ravel() for a in np.meshgrid(gx, gy))
        inside = shapely.contains_xy(polygon, xs, ys) & shapely.contains_xy(area, xs, ys)
        xs, ys = xs[inside], ys[inside]
        if len(xs) == 0:
            point = polygon.representative_point()
            if not area.contains(point):
                continue
            xs, ys = np.array([point.x]), np.array([point.y])
        wet = np.zeros(len(xs), dtype=bool)
        for j in water.query(shapely.box(minx, miny, maxx, maxy)):
            wet |= shapely.contains_xy(water.geometries[j], xs, ys)
        for x, y in zip(xs[~wet], ys[~wet]):
            out.add(x, y, "park", info["name"], f"park:{info['osm']}", hours=info["hours"])


def _named_water(osm):
    polygons, polygon_attrs = osm["water"]
    lines, line_attrs = osm["waterways"]
    geoms = np.concatenate([polygons, lines])
    names = [a["name"] for a in polygon_attrs] + [a["name"] for a in line_attrs]
    return geoms, names


def _waterside(osm, area, out: Candidates) -> None:
    water_geoms, water_names = _named_water(osm)
    water = shapely.STRtree(water_geoms)
    paths, attrs = osm["paths"]
    selected = np.nonzero(shapely.intersects(paths, area))[0]
    selected = np.array([i for i in selected if not attrs[i]["bridge"]], dtype=np.int64)
    if len(selected) == 0:
        return
    pairs = water.query(paths[selected], predicate="dwithin", distance=WATER_NEAR_M)
    near: dict[int, list[int]] = defaultdict(list)
    for path_pos, water_index in zip(*pairs):
        near[int(selected[path_pos])].append(int(water_index))
    polygons_only = len(osm["water"][0])
    for path_index, water_indexes in near.items():
        line = paths[path_index]
        if line.length < WATER_PATH_SPACING_M:
            points = [line.interpolate(0.5, normalized=True)]
        else:
            points = shapely.line_interpolate_point(
                line, np.arange(WATER_PATH_SPACING_M / 2, line.length, WATER_PATH_SPACING_M)
            )
        candidates_water = water_geoms[water_indexes]
        for point in points:
            if not area.contains(point):
                continue
            distances = shapely.distance(candidates_water, point)
            nearest = int(np.argmin(distances))
            if distances[nearest] > WATER_NEAR_M:
                continue
            # Skip points on the water itself (piers and paths drawn over a polygon).
            if any(water_indexes[k] < polygons_only and distances[k] == 0 for k in range(len(water_indexes))):
                continue
            name = next(
                (water_names[water_indexes[k]] for k in np.argsort(distances) if water_names[water_indexes[k]]),
                None,
            )
            out.add(point.x, point.y, "water", name, f"water:{name or path_index}")


def _bridges(osm, area, out: Candidates) -> None:
    water_geoms, water_names = _named_water(osm)
    water = shapely.STRtree(water_geoms)
    railways = shapely.STRtree(osm["railways"][0])
    paths, attrs = osm["paths"]
    for i in np.nonzero(shapely.intersects(paths, area))[0]:
        info = attrs[i]
        if not info["bridge"]:
            continue
        line = paths[i]
        crossing_water = water.query(line, predicate="intersects")
        if len(crossing_water):
            water_name = next((water_names[j] for j in crossing_water if water_names[j]), None)
            crosses = water_name or "the water"
        elif len(railways.query(line, predicate="intersects")):
            crosses = "the railway"
        else:
            continue  # bridges over roads rarely make good spots
        kind_word = "Footbridge" if info["highway"] in FOOT_HIGHWAYS else "Bridge"
        name = info["name"] if info["name"] and "bridge" in info["name"].lower() else None
        name = name or (f"{info['name']} bridge" if info["name"] else f"{kind_word} over {crosses}")
        distances = [line.length / 2] if line.length < 80 else np.arange(20, line.length - 10, 40)
        for point in shapely.line_interpolate_point(line, np.asarray(distances)):
            if area.contains(point):
                out.add(point.x, point.y, "bridge", name, f"bridge:{name}", eye_extra=BRIDGE_EYE_EXTRA_M)


def straight_runs(coords: np.ndarray, min_length: float, tolerance_deg: float):
    """Yield (start, end) points of straight stretches of a polyline at least min_length long."""
    start = 0
    while start < len(coords) - 1:
        end = start + 1
        heading = _bearing(coords[start], coords[end])
        while end + 1 < len(coords):
            if abs(_angle_diff(_bearing(coords[end], coords[end + 1]), heading)) > tolerance_deg:
                break
            end += 1
        if math.dist(coords[start], coords[end]) >= min_length:
            yield coords[start], coords[end]
        start = end


def _bearing(a, b) -> float:
    return math.degrees(math.atan2(b[0] - a[0], b[1] - a[1])) % 360


def _angle_diff(a: float, b: float) -> float:
    return (a - b + 180) % 360 - 180


def _streets(osm, area, out: Candidates) -> None:
    paths, attrs = osm["paths"]
    by_name: dict[str, list] = defaultdict(list)
    for i in np.nonzero(shapely.intersects(paths, area))[0]:
        info = attrs[i]
        if info["highway"] in STREET_HIGHWAYS and info["name"] and not info["bridge"]:
            by_name[info["name"]].append(paths[i])
    for name, lines in by_name.items():
        merged = shapely.line_merge(shapely.union_all(lines))
        for line in getattr(merged, "geoms", [merged]):
            coords = np.asarray(line.coords)
            for a, b in straight_runs(coords, STREET_MIN_RUN_M, STREET_STRAIGHT_DEG):
                east, west = (a, b) if a[0] > b[0] else (b, a)
                looking = _bearing(east, west)
                if not 225 <= looking <= 315:
                    continue
                # Stand 5 m in from the east end, looking west down the street.
                t = 5 / math.dist(east, west)
                x, y = east[0] + (west[0] - east[0]) * t, east[1] + (west[1] - east[1]) * t
                if area.contains(shapely.Point(x, y)):
                    out.add(x, y, "street", name, f"street:{name}", street_bearing=round(looking, 1))


def _viewpoints(osm, area, out: Candidates) -> None:
    for x, y, name, _direction in osm["viewpoints"]:
        if area.contains(shapely.Point(x, y)):
            out.add(x, y, "viewpoint", name, f"viewpoint:{name or (round(x), round(y))}")
