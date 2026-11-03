import numpy as np
import pytest
import shapely

from build_spots import clean_water_name, quality, score_profiles, thin
from candidates import straight_runs
from common import BEARINGS, sunset_bearings
from heightmap import HeightMap
from osm_extract import building_height, parse_length_m
from profiles import horizon_profiles, obstacle_at
from terrain import grid_letters, tile_name


def test_grid_letters_and_terrain_tiles():
    assert grid_letters(530_000, 180_000) == "TQ"
    assert grid_letters(505_000, 205_000) == "TL"
    assert grid_letters(495_000, 175_000) == "SU"
    assert tile_name(532_800, 183_000) == "tq38"
    assert tile_name(505_000, 205_000) == "tl00"


def test_sunset_swings_about_80_degrees_over_the_year_in_london():
    bearings = sunset_bearings()
    assert len(bearings) == 365
    assert 231 < bearings.min() < 233  # December
    assert 310 < bearings.max() < 312  # June


def flat_map(size_m=1000.0, cell=5.0) -> HeightMap:
    n = int(size_m / cell)
    zeros = np.zeros((n, n), dtype=np.float32)
    return HeightMap(x0=0.0, y_top=size_m, cell=cell, ground=zeros.copy(), buildings=zeros.copy(), surface=zeros.copy())


def test_view_profile_sees_a_wall_to_the_west():
    hm = flat_map()
    hm.surface[:, 79:81] = 20.0  # a 20 m wall at x = 395–405 m, running north–south
    profile = horizon_profiles(hm, np.array([500.0]), np.array([500.0]), np.array([1.6]))[0]
    west = profile[list(BEARINGS).index(270)]
    assert west == pytest.approx(np.degrees(np.arctan(18.4 / 100)), abs=0.6)
    # Looking south-west the wall is further away along the ray, so it looks lower.
    assert profile[0] < west
    assert profile[0] == pytest.approx(np.degrees(np.arctan(18.4 / (100 / np.sin(np.radians(40))))), abs=0.8)


def test_open_ground_is_slightly_below_the_horizon():
    hm = flat_map()
    profile = horizon_profiles(hm, np.array([500.0]), np.array([500.0]), np.array([1.6]))[0]
    assert (profile < 0).all()


def test_obstacle_at_interpolates_between_bearings():
    profiles = np.array([np.linspace(0, 10, len(BEARINGS))], dtype=np.float32)
    assert obstacle_at(profiles, np.array([220.0, 271.0, 320.0]))[0] == pytest.approx([0, 5.1, 10], abs=1e-5)


def test_scores_open_and_blocked_views():
    profiles = np.array([np.zeros(len(BEARINGS)), np.full(len(BEARINGS), 30.0)], dtype=np.float32)
    kinds = np.array(["park", "park"], dtype=object)
    assert list(score_profiles(profiles, kinds, np.array([np.nan, np.nan]))) == [100, 0]
    assert list(quality(np.array([1.0, 3.0, 8.0, 20.0]))) == [1.0, 0.75, 0.35, 0.0]


def test_a_street_counts_only_if_open_straight_down_it():
    profile = np.full(len(BEARINGS), 30.0, dtype=np.float32)
    profile[list(BEARINGS).index(270)] = 1.0
    kinds = np.array(["street", "street"], dtype=object)
    scores = score_profiles(np.array([profile, profile]), kinds, np.array([270.0, 240.0]))
    assert list(scores) == [50, 0]


def test_thinning_keeps_the_best_and_spaces_out_one_park():
    x = np.array([0.0, 50.0, 500.0, 900.0, 1300.0])
    y = np.zeros(5)
    score = np.array([90, 80, 70, 60, 50])
    group = np.array(["park:a", "park:a", "park:a", "park:b", "park:a"], dtype=object)
    kept = thin(x, y, score, np.ones(5, dtype=bool), group)
    assert list(kept) == [0, 2, 3, 4]  # #1 is too close to #0


def test_straight_runs_find_long_straight_stretches():
    line = np.array([[0, 0], [100, 0], [300, 1], [300, 200]], dtype=float)
    runs = list(straight_runs(line, 250, 4))
    assert len(runs) == 1
    assert tuple(runs[0][0]) == (0, 0) and tuple(runs[0][1]) == (300, 1)


def test_building_heights_from_tags():
    assert parse_length_m("12 m") == 12
    assert parse_length_m("40'") == pytest.approx(12.19, abs=0.01)
    assert parse_length_m("tall") is None
    assert building_height({"height": "30"}) == 30
    assert building_height({"building:levels": "4"}) == 13
    assert building_height({"building": "house"}) == 8
    assert building_height({"building": "yes"}) == 9


def test_canal_names_lose_the_tunnel_prefix():
    assert clean_water_name("Islington Tunnel (Regent's Canal)") == "Regent's Canal"
    assert clean_water_name("Regent's Canal") == "Regent's Canal"
    assert clean_water_name(None) is None


def test_shapely_is_v2():
    # The pipeline relies on vectorised shapely 2 functions.
    assert int(shapely.__version__.split(".")[0]) >= 2
