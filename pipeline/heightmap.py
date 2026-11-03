"""A surface height grid: ground plus buildings plus trees, in metres above sea level."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import rasterio.features
import rasterio.transform
import shapely
from rasterio.enums import MergeAlg

from terrain import Terrain

WOOD_M = 15.0
TREE_M = 12.0
TREE_RADIUS_M = 4.0


@dataclass
class HeightMap:
    x0: float
    y_top: float
    cell: float
    ground: np.ndarray  # metres above sea level
    buildings: np.ndarray  # building height above ground (0 where none)
    surface: np.ndarray  # ground + tallest of buildings and trees

    @property
    def shape(self) -> tuple[int, int]:
        return self.surface.shape

    def cell_index(self, x: np.ndarray, y: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        rows = np.floor((self.y_top - np.asarray(y)) / self.cell).astype(np.int64)
        cols = np.floor((np.asarray(x) - self.x0) / self.cell).astype(np.int64)
        inside = (rows >= 0) & (rows < self.shape[0]) & (cols >= 0) & (cols < self.shape[1])
        return np.clip(rows, 0, self.shape[0] - 1), np.clip(cols, 0, self.shape[1] - 1), inside

    def sample(self, layer: np.ndarray, x: np.ndarray, y: np.ndarray, outside: float = 0.0) -> np.ndarray:
        rows, cols, inside = self.cell_index(x, y)
        return np.where(inside, layer[rows, cols], outside)


def build_heightmap(bbox, cell: float, terrain: Terrain, osm: dict) -> HeightMap:
    xmin, ymin, xmax, ymax = (
        np.floor(bbox[0] / cell) * cell,
        np.floor(bbox[1] / cell) * cell,
        np.ceil(bbox[2] / cell) * cell,
        np.ceil(bbox[3] / cell) * cell,
    )
    width, height = int((xmax - xmin) / cell), int((ymax - ymin) / cell)
    transform = rasterio.transform.from_origin(xmin, ymax, cell, cell)
    area = shapely.box(xmin, ymin, xmax, ymax)

    def burn(shapes, all_touched=False) -> np.ndarray:
        out = np.zeros((height, width), dtype=np.float32)
        shapes = list(shapes)
        if shapes:
            rasterio.features.rasterize(
                shapes, out=out, transform=transform, merge_alg=MergeAlg.replace, all_touched=all_touched
            )
        return out

    geoms, heights = osm["buildings"]
    keep = shapely.intersects(geoms, area)
    buildings = burn(zip(geoms[keep], np.asarray(heights, dtype=np.float32)[keep]))

    tree_shapes = []
    woods = osm["woods"][0]
    tree_shapes += [(g, WOOD_M) for g in woods[shapely.intersects(woods, area)]]
    rows = osm["tree_rows"][0]
    tree_shapes += [(g, TREE_M) for g in shapely.buffer(rows[shapely.intersects(rows, area)], TREE_RADIUS_M)]
    points = osm["trees"]
    if len(points):
        inside = (points[:, 0] >= xmin) & (points[:, 0] <= xmax) & (points[:, 1] >= ymin) & (points[:, 1] <= ymax)
        circles = shapely.buffer(shapely.points(points[inside]), TREE_RADIUS_M, quad_segs=2)
        tree_shapes += [(g, TREE_M) for g in circles]
    trees = burn(tree_shapes, all_touched=True)

    ground = np.empty((height, width), dtype=np.float32)
    xs = xmin + (np.arange(width) + 0.5) * cell
    for start in range(0, height, 256):
        stop = min(height, start + 256)
        ys = ymax - (np.arange(start, stop) + 0.5) * cell
        gx, gy = np.meshgrid(xs, ys)
        ground[start:stop] = terrain.at(gx, gy)

    surface = ground + np.maximum(buildings, trees)
    return HeightMap(x0=float(xmin), y_top=float(ymax), cell=cell, ground=ground, buildings=buildings, surface=surface)
