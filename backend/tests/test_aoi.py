import json
import math
from pathlib import Path

import numpy as np
import pytest
from pydantic import TypeAdapter, ValidationError

from almatafi import cells
from app.aoi import Aoi, AdminStore, LIMIT_POINTS_KM2, geodesic_area_km2, resolve
from app.errors import ApiError
from app.regions import REGIONS
from shapely.geometry import box

PARSE = TypeAdapter(Aoi).validate_python


@pytest.fixture
def admin(tmp_path):
    feature = {"type": "Feature", "properties": {"admin_id": "EGY-ADM1-TEST", "name": "Test", "level": 1, "country": "EGY"},
               "geometry": {"type": "Polygon", "coordinates": [[[30.5, 30.5], [31.5, 30.5], [31.5, 31.5], [30.5, 31.5], [30.5, 30.5]]]}}
    (tmp_path / "EGY_ADM1.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": [feature]}))
    return AdminStore(tmp_path)


def _resolve(aoi, admin=None):
    return resolve(PARSE(aoi), REGIONS, admin or AdminStore(__import__("pathlib").Path("/nonexistent")))


def _poly(*ring):
    return {"type": "polygon", "geometry": {"type": "Polygon", "coordinates": [list(map(list, ring))]}}


def _error(aoi, admin=None) -> ApiError:
    with pytest.raises(ApiError) as e:
        _resolve(aoi, admin)
    return e.value


def test_bbox_cells_are_the_centres_inside():
    r = _resolve({"type": "bbox", "bbox": [31.0, 30.5, 31.6, 31.2]})
    # 6 columns × 7 rows of 0.1° cells, centres strictly inside.
    assert r.cell_ids.size == 42 and not r.coarse_warning
    assert cells.cell_id(30.55, 31.05) in r.cell_ids and cells.cell_id(31.25, 31.05) not in r.cell_ids
    assert r.area_km2 == pytest.approx(4454, rel=0.001)
    assert r.meta() == {"area_km2": round(r.area_km2, 1), "cells": 42,
                        "bbox": [31.0, 30.5, 31.6, 31.2], "coarse_warning": False}


def test_every_form_gives_the_same_cells_for_the_same_box(admin):
    ring = [(30.5, 30.5), (31.5, 30.5), (31.5, 31.5), (30.5, 31.5), (30.5, 30.5)]
    a = _resolve({"type": "bbox", "bbox": [30.5, 30.5, 31.5, 31.5]})
    b = _resolve(_poly(*ring))
    c = _resolve({"type": "admin", "admin_id": "EGY-ADM1-TEST"}, admin)
    assert np.array_equal(a.cell_ids, b.cell_ids) and np.array_equal(a.cell_ids, c.cell_ids)
    assert a.cell_ids.size == 100


def test_region():
    r = _resolve({"type": "region", "region_id": "nile-delta"})
    assert r.cell_ids.size == 24 * 16 and r.bbox == [29.9, 30.0, 32.3, 31.6]


def test_point_radius_area_and_cells():
    r = _resolve({"type": "point", "lat": 30.8, "lon": 31.3, "radius_km": 50})
    assert r.area_km2 == pytest.approx(math.pi * 50**2, rel=0.01)
    assert cells.cell_id(30.8, 31.3) in r.cell_ids
    assert 55 < r.cell_ids.size < 80  # ≈ 7854 km² / ~107 km² per cell


def test_small_area_is_coarse():
    r = _resolve({"type": "point", "lat": 30.8, "lon": 31.3, "radius_km": 1})
    assert r.coarse_warning and r.cell_ids.size >= 1
    assert cells.cell_id(30.8, 31.3) in r.cell_ids


def test_tiny_box_inside_one_cell():
    r = _resolve({"type": "bbox", "bbox": [31.21, 30.81, 31.22, 30.82]})
    assert r.coarse_warning and r.cell_ids.tolist() == [cells.cell_id(30.815, 31.215)]


@pytest.mark.parametrize("aoi", [
    {"type": "bbox", "bbox": [179.5, -17.0, -179.5, -16.0]},
    _poly((179.5, -17), (-179.5, -17), (-179.5, -16), (179.5, -16), (179.5, -17)),
    _poly((179.5, -17), (180.5, -17), (180.5, -16), (179.5, -16), (179.5, -17)),  # MapLibre can give lon > 180
])
def test_antimeridian(aoi):
    r = _resolve(aoi)
    assert r.geometry.geom_type == "MultiPolygon"
    assert r.cell_ids.size == 100
    assert r.bbox == [179.5, -17.0, -179.5, -16.0]
    assert cells.cell_id(-16.5, 179.95) in r.cell_ids and cells.cell_id(-16.5, -179.95) in r.cell_ids
    assert r.area_km2 == pytest.approx(geodesic_area_km2(box(0, -17, 1, -16)), rel=1e-6)


@pytest.mark.parametrize("start", [179, -179])
def test_hole_across_antimeridian_lines_up_with_its_shell(start):
    """The hole's first vertex shouldn't decide which side of 180° it lands on (it is 3° wide)."""
    shell = [(175, -20), (-175, -20), (-175, -10), (175, -10), (175, -20)]
    hole = [(start, -16), (-178 if start == 179 else 178, -16), (-178 if start == 179 else 178, -14), (start, -14), (start, -16)]
    r = _resolve({"type": "polygon", "geometry": {"type": "Polygon", "coordinates": [shell, hole]}})
    # Area doesn't depend on longitude, so compare with the same shapes away from 180°.
    full = geodesic_area_km2(box(0, -20, 10, -10))
    assert r.area_km2 == pytest.approx(full - geodesic_area_km2(box(3, -16, 6, -14)), rel=1e-6)


def test_circle_across_antimeridian():
    r = _resolve({"type": "point", "lat": -16.5, "lon": 179.9, "radius_km": 100})
    assert r.geometry.geom_type == "MultiPolygon"
    assert r.area_km2 == pytest.approx(math.pi * 100**2, rel=0.01)


def test_polar_circle_becomes_a_cap():
    r = _resolve({"type": "point", "lat": 89.5, "lon": 0, "radius_km": 200})
    assert r.bbox[0] == -180 and r.bbox[2] == 180 and r.bbox[3] == 90
    assert r.area_km2 > 0


def test_whole_world_is_too_large_not_empty():
    with pytest.raises(ApiError) as e:
        resolve(PARSE({"type": "bbox", "bbox": [-180, -90, 180, 90]}), REGIONS, AdminStore(Path("/x")),
                max_area_km2=LIMIT_POINTS_KM2, what="hotspots")
    assert e.value.status == 422 and e.value.code == "too_large"
    assert "limit for hotspots is 500,000 km²" in e.value.message
    assert e.value.details["area_km2"] == pytest.approx(510.066e6, rel=1e-4)


def test_area_limit_is_checked_before_scanning_cells(monkeypatch):
    import app.aoi as aoi_mod
    monkeypatch.setattr(aoi_mod, "cells_in", lambda g: pytest.fail("cells scanned before the area check"))
    with pytest.raises(ApiError):
        resolve(PARSE({"type": "bbox", "bbox": [0, 0, 30, 30]}), REGIONS, AdminStore(Path("/x")),
                max_area_km2=1000)


@pytest.mark.parametrize("bad", [float("inf"), float("-inf"), float("nan"), 1e308, 600])
def test_non_finite_or_absurd_coordinates(bad):
    e = _error(_poly((0, 0), (1, 0), (bad, 1), (0, 0)))
    assert e.code == "invalid_aoi"


def test_thin_diagonal_sliver_is_refused_cheaply():
    # Tiny area, but its bounding box covers 160° × 160° of cells (2.56M).
    e = _error(_poly((-80, -80), (80, 80), (80, 80.001), (-80, -80)))
    assert e.code == "invalid_aoi" and e.details["cells_scanned"] > 1_500_000


def test_many_parts_count_together():
    # Six slivers of 300k candidate cells each: fine alone, refused together.
    parts = [[[[x, -30], [x + 50, 30], [x + 50, 30.001], [x, -30]]] for x in (-170, -115, -60, -5, 50, 105)]
    assert _resolve({"type": "polygon", "geometry": {"type": "MultiPolygon", "coordinates": parts[:1]}})
    e = _error({"type": "polygon", "geometry": {"type": "MultiPolygon", "coordinates": parts}})
    assert e.code == "invalid_aoi" and e.details["cells_scanned"] > 1_500_000


@pytest.mark.parametrize("aoi,code,status", [
    (_poly((0, 0), (1, 1), (1, 0), (0, 1), (0, 0)), "invalid_aoi", 422),             # bow tie
    (_poly((0, 0), (1, 0), (0, 0)), "invalid_aoi", 422),                               # no area
    (_poly(*[(math.cos(a), math.sin(a)) for a in np.linspace(0, 2 * math.pi, 2001)]), "invalid_aoi", 422),
    (_poly((0, 89), (1, 89), (1, 91), (0, 89)), "invalid_aoi", 422),
    ({"type": "polygon", "geometry": {"type": "Point", "coordinates": [0, 0]}}, "invalid_aoi", 422),
    ({"type": "polygon", "geometry": {"type": "Polygon", "coordinates": "nope"}}, "invalid_aoi", 422),
    ({"type": "bbox", "bbox": [1, 0, 1, 1]}, "invalid_aoi", 422),
    ({"type": "bbox", "bbox": [0, 1, 1, 0]}, "invalid_aoi", 422),
    ({"type": "bbox", "bbox": [0, 0, 1, 95]}, "invalid_aoi", 422),
    ({"type": "point", "lat": 0, "lon": 0, "radius_km": 600}, "invalid_aoi", 422),
    ({"type": "point", "lat": 0, "lon": 0, "radius_km": 0.5}, "invalid_aoi", 422),
    ({"type": "point", "lat": 95, "lon": 0, "radius_km": 10}, "invalid_aoi", 422),
    ({"type": "region", "region_id": "atlantis"}, "not_found", 404),
    ({"type": "admin", "admin_id": "XXX"}, "not_found", 404),
])
def test_errors(aoi, code, status):
    e = _error(aoi)
    assert (e.status, e.code) == (status, code)


@pytest.mark.parametrize("aoi", [{"type": "circle"}, {"type": "bbox", "bbox": [0, 0, 1]}, {"type": "point", "lat": 1}])
def test_malformed_is_rejected_by_the_schema(aoi):
    with pytest.raises(ValidationError):
        PARSE(aoi)


def test_vertex_limit_counts_rings():
    ring = [(math.cos(a), math.sin(a)) for a in np.linspace(0, 2 * math.pi, 2000)]
    assert _resolve(_poly(*ring)).area_km2 > 0


@pytest.mark.parametrize("lat,radius_km", [(89.5, 200), (86, 500), (90, 100), (-89.9, 500), (85, 500)])
def test_circles_near_a_pole_keep_their_size(lat, radius_km):
    # Around a pole the circle is closed along the pole, not widened into a whole polar cap
    # (which made a 500 km circle at 86°N 3.6 times too big). (85, 500) doesn't reach the pole.
    r = _resolve({"type": "point", "lat": lat, "lon": 20, "radius_km": radius_km})
    assert r.area_km2 == pytest.approx(math.pi * radius_km**2, rel=0.01)
    centre = cells.cell_id(lat, 20)
    assert centre in r.cell_ids


def test_shape_in_parts_on_both_sides_of_180_gets_a_small_crossing_bbox():
    # Like Fiji or the Aleutians in geoBoundaries: separate parts, not one ring across 180°.
    parts = [[[[177, -18], [179.9, -18], [179.9, -16], [177, -16], [177, -18]]],
             [[[-180, -17], [-179.5, -17], [-179.5, -16.5], [-180, -16.5], [-180, -17]]]]
    r = _resolve({"type": "polygon", "geometry": {"type": "MultiPolygon", "coordinates": parts}})
    assert r.bbox == [177.0, -18.0, -179.5, -16.0]


def test_parts_far_apart_on_one_side_keep_a_normal_bbox():
    parts = [[[[-10, 0], [-5, 0], [-5, 1], [-10, 1], [-10, 0]]], [[[5, 0], [10, 0], [10, 1], [5, 1], [5, 0]]]]
    r = _resolve({"type": "polygon", "geometry": {"type": "MultiPolygon", "coordinates": parts}})
    assert r.bbox == [-10.0, 0.0, 10.0, 1.0]
