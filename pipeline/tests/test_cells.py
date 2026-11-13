import json
import math
from pathlib import Path

import numpy as np
import pytest

from almatafi import cells

VECTORS = json.loads(
    (Path(__file__).resolve().parents[2] / "contracts" / "grid-test-vectors.json").read_text()
)


def _num(v):
    return math.nan if v is None else v


@pytest.mark.parametrize("v", VECTORS["cells"], ids=lambda v: f"{v['lat']},{v['lon']}")
def test_vectors(v):
    cid = cells.cell_id(v["lat"], v["lon"])
    assert cid == v["cell_id"]
    assert cells.cell_row(v["lat"]) == v["row"]
    assert cells.cell_col(v["lon"]) == v["col"]
    assert cells.cell_row_col(cid) == (v["row"], v["col"])
    assert cells.cell_center(cid) == pytest.approx((v["cell_lat"], v["cell_lon"]), abs=1e-12)
    assert cells.cell_ids([v["lat"]], [v["lon"]]).tolist() == [v["cell_id"]]


@pytest.mark.parametrize("v", VECTORS["invalid"], ids=lambda v: f"{v['lat']},{v['lon']}")
def test_invalid_points_raise(v):
    lat, lon = _num(v["lat"]), _num(v["lon"])
    with pytest.raises(ValueError):
        cells.cell_id(lat, lon)
    with pytest.raises(ValueError):
        cells.cell_ids([0.0, lat], [0.0, lon])


@pytest.mark.parametrize("bad", [-1, cells.N_CELLS, 1.5, math.nan, True, "7"])
def test_invalid_ids_raise(bad):
    with pytest.raises(ValueError):
        cells.cell_center(bad)


def test_whole_number_ids_and_rows_accepted():
    # Same as Number.isInteger in grid.ts: 12345.0 and numpy ints are fine.
    assert cells.cell_center(12345.0) == cells.cell_center(np.int64(12345)) == cells.cell_center(12345)
    assert cells.row_area_km2(900.0) == cells.row_area_km2(np.int32(900))


@pytest.mark.parametrize("bad", [1.5, -1, cells.N_ROWS, math.nan])
def test_invalid_rows_raise(bad):
    with pytest.raises(ValueError):
        cells.row_area_km2(bad)


def test_month_checks():
    assert cells.stratum_chain(30.1, 31.2, 10.0) == cells.stratum_chain(30.1, 31.2, np.int64(10))
    for bad in [0, 13, 10.5, math.nan]:
        with pytest.raises(ValueError):
            cells.stratum_chain(30.1, 31.2, bad)


@pytest.mark.parametrize("v", VECTORS["areas"], ids=lambda v: f"row{v['row']}")
def test_areas(v):
    assert cells.row_area_km2(v["row"]) == pytest.approx(v["area_km2"], abs=v["tolerance"])


def test_areas_sum_to_earth():
    total = sum(cells.row_area_km2(r) for r in range(cells.N_ROWS)) * cells.N_COLS
    assert total == pytest.approx(4 * math.pi * cells.EARTH_RADIUS_KM**2, rel=1e-9)


@pytest.mark.parametrize("v", VECTORS["strata"], ids=lambda v: f"{v['lat']},{v['lon']}")
def test_strata(v):
    assert cells.tile_id(v["lat"], v["lon"]) == v["tile_id"]
    assert cells.stratum_chain(v["lat"], v["lon"], v["month"]) == v["chain"]


def test_bounds_contain_center():
    for cid in [0, 3241800, 4325712, cells.N_CELLS - 1]:
        b = cells.cell_bounds(cid)
        w, s, e, n = b
        assert (b.west, b.south, b.east, b.north) == (w, s, e, n)
        lat, lon = cells.cell_center(cid)
        assert w < lon < e and s < lat < n
        assert e - w == pytest.approx(0.1) and n - s == pytest.approx(0.1)


def test_every_center_maps_back_to_its_cell():
    ids = np.arange(cells.N_CELLS)
    row, col = np.divmod(ids, cells.N_COLS)
    lat = (2 * row + 1 - 1800) / 20
    lon = (2 * col + 1 - 3600) / 20
    assert np.array_equal(cells.cell_ids(lat, lon), ids)


def _exact_index(n, offset, size):
    # n is the coordinate × 1e5 as an integer; cells are 1e4 units wide.
    return np.minimum((n + offset) // 10_000, size - 1)


def test_every_5_decimal_latitude():
    # FIRMS gives coordinates to at most 5 decimals; check all of them against integer maths.
    n = np.arange(-9_000_000, 9_000_001, dtype=np.int64)
    got = cells.cell_ids(n / 1e5, np.zeros(n.size)) // cells.N_COLS
    assert np.array_equal(got, _exact_index(n, 9_000_000, cells.N_ROWS))


def test_every_5_decimal_longitude():
    for start in range(-18_000_000, 18_000_001, 9_000_000):
        n = np.arange(start, min(start + 9_000_000, 18_000_001), dtype=np.int64)
        got = cells.cell_ids(np.zeros(n.size), n / 1e5) % cells.N_COLS
        assert np.array_equal(got, _exact_index(n, 18_000_000, cells.N_COLS))


def test_scalar_matches_vector():
    rng = np.random.default_rng(42)
    lat = rng.integers(-9_000_000, 9_000_001, 200_000) / 1e5
    lon = rng.integers(-18_000_000, 18_000_001, 200_000) / 1e5
    vec = cells.cell_ids(lat, lon)
    assert vec.dtype == np.int32
    # .tolist() gives plain Python floats; round() on np.float64 would use numpy's rounding.
    assert [cells.cell_id(a, b) for a, b in zip(lat.tolist(), lon.tolist())] == vec.tolist()


def test_scalar_matches_vector_near_edges():
    # Points within ~5e-11° below an edge, where "round to 9 decimals" can be read
    # several ways (grid.md §2). Scalar, vector and grid.ts must all follow the same steps.
    rng = np.random.default_rng(7)
    k_lat = rng.integers(1, cells.N_ROWS, 100_000)
    k_lon = rng.integers(1, cells.N_COLS, 100_000)
    off = rng.choice([5e-10, -5e-10, 1e-12, -1e-12], 100_000) + rng.uniform(-3e-13, 3e-13, 100_000)
    lat = (k_lat + off) / 10 - 90
    lon = (k_lon + off) / 10 - 180
    vec = cells.cell_ids(lat, lon)
    # .tolist() gives plain Python floats; round() on np.float64 would use numpy's rounding.
    assert [cells.cell_id(a, b) for a, b in zip(lat.tolist(), lon.tolist())] == vec.tolist()
