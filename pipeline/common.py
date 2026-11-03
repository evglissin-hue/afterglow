"""Shared constants and helpers for the spot pipeline. All geometry is in British National Grid metres."""

from __future__ import annotations

import math
from datetime import date

import numpy as np
from pyproj import Transformer

TO_BNG = Transformer.from_crs("EPSG:4326", "EPSG:27700", always_xy=True)
TO_WGS = Transformer.from_crs("EPSG:27700", "EPSG:4326", always_xy=True)

# Where to look for spots, as (lat_min, lon_min, lat_max, lon_max).
AREAS = {
    "hoxton": (51.512, -0.123, 51.549, -0.064),
    "london": (51.286, -0.510, 51.692, 0.334),
}

CELL_M = 5.0  # height map resolution
RAY_M = 3000.0  # how far each ray looks
BEARINGS = np.arange(220, 321, 2, dtype=np.float64)  # view profile directions, degrees from north
EYE_M = 1.6
# Bridge decks sit roughly at street level in the 50 m terrain grid, which smooths out canal and rail cuttings.
BRIDGE_EYE_EXTRA_M = 1.0
LONDON_LAT = 51.5072


def area_bng(name: str, margin: float = 0.0) -> tuple[float, float, float, float]:
    lat0, lon0, lat1, lon1 = AREAS[name]
    xs, ys = TO_BNG.transform([lon0, lon1, lon0, lon1], [lat0, lat0, lat1, lat1])
    return (min(xs) - margin, min(ys) - margin, max(xs) + margin, max(ys) + margin)


def project(coords: np.ndarray) -> np.ndarray:
    """(N, 2) lon/lat array to British National Grid, for shapely.transform."""
    x, y = TO_BNG.transform(coords[:, 0], coords[:, 1])
    return np.column_stack([x, y])


def sunset_bearings(lat: float = LONDON_LAT, year: int = 2027) -> np.ndarray:
    """Compass bearing of sunset for every day of `year` (NOAA declination; sun centre at -0.833 deg)."""
    n_days = 366 if year % 4 == 0 else 365
    jd = 2451545.0 + (date(year, 1, 1) - date(2000, 1, 1)).days + np.arange(n_days)  # noon UTC
    t = (jd - 2451545.0) / 36525.0
    l0 = (280.46646 + t * (36000.76983 + t * 0.0003032)) % 360
    m = np.radians(357.52911 + t * (35999.05029 - 0.0001537 * t))
    c = (
        np.sin(m) * (1.914602 - t * (0.004817 + 0.000014 * t))
        + np.sin(2 * m) * (0.019993 - 0.000101 * t)
        + np.sin(3 * m) * 0.000289
    )
    omega = np.radians(125.04 - 1934.136 * t)
    lam = np.radians(l0 + c - 0.00569 - 0.00478 * np.sin(omega))
    eps0 = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60
    eps = np.radians(eps0 + 0.00256 * np.cos(omega))
    dec = np.arcsin(np.sin(eps) * np.sin(lam))
    phi, h0 = math.radians(lat), math.radians(-0.833)
    cos_a = (np.sin(dec) - math.sin(phi) * math.sin(h0)) / (math.cos(phi) * math.cos(h0))
    return 360.0 - np.degrees(np.arccos(np.clip(cos_a, -1, 1)))
