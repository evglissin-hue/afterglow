"""Ground height from Ordnance Survey Terrain 50: a 50 m grid of metres above sea level."""

from __future__ import annotations

import io
import math
import zipfile
from pathlib import PurePosixPath

import numpy as np

TILE_M = 10_000
CELL_M = 50.0
TILE_CELLS = 200


def grid_letters(easting: float, northing: float) -> str:
    """British National Grid 100 km square letters, e.g. (530000, 180000) -> 'TQ'."""
    e100, n100 = int(easting // 100_000), int(northing // 100_000)
    first = (19 - n100) - (19 - n100) % 5 + (e100 + 10) // 5
    second = (19 - n100) * 5 % 25 + e100 % 5
    first += first > 7  # the grid skips the letter I
    second += second > 7
    return chr(first + 65) + chr(second + 65)


def tile_name(easting: float, northing: float) -> str:
    """Terrain 50 tile containing a point, e.g. (532800, 183000) -> 'tq38'."""
    digits = f"{int(easting % 100_000 // TILE_M)}{int(northing % 100_000 // TILE_M)}"
    return (grid_letters(easting, northing) + digits).lower()


class Terrain:
    def __init__(self, grid: np.ndarray, x0: float, y_top: float):
        self.grid = grid  # row 0 is the northern edge
        self.x0 = x0
        self.y_top = y_top

    def at(self, x: np.ndarray, y: np.ndarray) -> np.ndarray:
        """Bilinear ground height at points; sea or missing tiles count as 0 m."""
        fx = (np.asarray(x, dtype=np.float64) - self.x0) / CELL_M - 0.5
        fy = (self.y_top - np.asarray(y, dtype=np.float64)) / CELL_M - 0.5
        rows, cols = self.grid.shape
        i0 = np.clip(np.floor(fy).astype(np.int64), 0, rows - 2)
        j0 = np.clip(np.floor(fx).astype(np.int64), 0, cols - 2)
        wy = np.clip(fy - i0, 0, 1)
        wx = np.clip(fx - j0, 0, 1)
        g = np.nan_to_num(self.grid, nan=0.0)
        top = g[i0, j0] * (1 - wx) + g[i0, j0 + 1] * wx
        bottom = g[i0 + 1, j0] * (1 - wx) + g[i0 + 1, j0 + 1] * wx
        return (top * (1 - wy) + bottom * wy).astype(np.float32)


def load_terrain(zip_path: str, bbox: tuple[float, float, float, float]) -> Terrain:
    xmin, ymin, xmax, ymax = bbox
    x0 = math.floor(xmin / TILE_M) * TILE_M
    y0 = math.floor(ymin / TILE_M) * TILE_M
    x1 = math.ceil(xmax / TILE_M) * TILE_M
    y1 = math.ceil(ymax / TILE_M) * TILE_M
    grid = np.full((int((y1 - y0) / CELL_M), int((x1 - x0) / CELL_M)), np.nan, dtype=np.float32)

    with zipfile.ZipFile(zip_path) as outer:
        members = {
            PurePosixPath(name).name.lower()[:4]: name
            for name in outer.namelist()
            if name.lower().endswith(".zip")
        }
        for easting in range(x0, x1, TILE_M):
            for northing in range(y0, y1, TILE_M):
                member = members.get(tile_name(easting, northing))
                if member is None:
                    continue  # sea
                with zipfile.ZipFile(io.BytesIO(outer.read(member))) as inner:
                    asc = next(n for n in inner.namelist() if n.lower().endswith(".asc"))
                    data, xll, yll = _read_ascii_grid(inner.read(asc).decode("ascii"))
                col = int((xll - x0) / CELL_M)
                row = int((y1 - (yll + TILE_CELLS * CELL_M)) / CELL_M)
                grid[row : row + data.shape[0], col : col + data.shape[1]] = data
    return Terrain(grid, x0, y1)


def _read_ascii_grid(text: str) -> tuple[np.ndarray, float, float]:
    lines = text.splitlines()
    header: dict[str, float] = {}
    for line in lines[:6]:
        key, *rest = line.split()
        if key.lower() in ("ncols", "nrows", "xllcorner", "yllcorner", "cellsize", "nodata_value"):
            header[key.lower()] = float(rest[0])
    body = lines[len(header) :]
    data = np.array([row.split() for row in body if row.strip()], dtype=np.float32)
    if "nodata_value" in header:
        data[data == header["nodata_value"]] = np.nan
    return data, header["xllcorner"], header["yllcorner"]
