"""View profiles: how high obstacles rise above the horizon from a point, in each westerly direction."""

from __future__ import annotations

import numpy as np

from common import BEARINGS, RAY_M
from heightmap import HeightMap

EARTH_RADIUS_M = 6_371_000.0
REFRACTION_K = 0.13  # usual coefficient for light bending near the ground


def ray_distances(cell: float) -> np.ndarray:
    """Sample spacing grows with distance: fine nearby, coarser far away."""
    return np.concatenate(
        [np.arange(cell, 200, cell), np.arange(200, 1000, 2 * cell), np.arange(1000, RAY_M + 1, 4 * cell)]
    )


def horizon_profiles(hm: HeightMap, xs: np.ndarray, ys: np.ndarray, eye_z: np.ndarray, batch: int = 800) -> np.ndarray:
    """Obstacle angle (degrees above the horizon) for each point and each bearing in BEARINGS."""
    distances = ray_distances(hm.cell)
    bearings = np.radians(BEARINGS)
    dx = (np.sin(bearings)[:, None] * distances[None, :]).ravel()
    dy = (np.cos(bearings)[:, None] * distances[None, :]).ravel()
    d = np.tile(distances, len(bearings))
    drop = d**2 * (1 - REFRACTION_K) / (2 * EARTH_RADIUS_M)  # the Earth curves away

    out = np.empty((len(xs), len(bearings)), dtype=np.float32)
    for start in range(0, len(xs), batch):
        part = slice(start, start + batch)
        h = hm.sample(hm.surface, xs[part, None] + dx[None, :], ys[part, None] + dy[None, :], outside=-1e4)
        angle = np.degrees(np.arctan2(h - eye_z[part, None] - drop[None, :], d[None, :]))
        out[part] = angle.reshape(-1, len(bearings), len(distances)).max(axis=2)
    return out


def obstacle_at(profiles: np.ndarray, bearings: np.ndarray) -> np.ndarray:
    """Interpolate profiles (N, len(BEARINGS)) at arbitrary bearings (M,) -> (N, M)."""
    position = np.clip((np.asarray(bearings) - BEARINGS[0]) / (BEARINGS[1] - BEARINGS[0]), 0, len(BEARINGS) - 1)
    lo = np.floor(position).astype(np.int64)
    hi = np.minimum(lo + 1, len(BEARINGS) - 1)
    w = position - lo
    return profiles[:, lo] * (1 - w) + profiles[:, hi] * w
