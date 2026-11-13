import csv
import io
import json
from datetime import date

import numpy as np
import pandas as pd
import pytest
import rasterio
from fastapi.testclient import TestClient
from rasterio.io import MemoryFile

from almatafi import cells
from almatafi.grid import build as build_grid
from almatafi.harmonize.build import build as harmonize
from almatafi.ingest import ingest
from almatafi.mock.generate import firms_files, generate, write
from app.config import Settings
from app.main import create_app

TODAY = date(2026, 11, 2)
NILE = {"type": "region", "region_id": "nile-delta"}
BOX = {"type": "bbox", "bbox": [31.0, 30.5, 31.6, 31.2]}
TRIANGLE = {"type": "polygon", "geometry": {"type": "Polygon", "coordinates": [
    [[30.5, 30.5], [32.0, 30.5], [31.25, 31.5], [30.5, 30.5]]]}}


@pytest.fixture(scope="module")
def data(tmp_path_factory):
    root, end = tmp_path_factory.mktemp("b3a"), date(2026, 10, 31)
    write(generate(seed=2026, end=end, regions=["nile-delta", "rio-negro"]), root / "raw", seed=2026, end=end,
          messy_year=None)
    files = firms_files(root / "raw")
    ingest(files, root / "clean", root / "rep", "mock", today=end)
    build_grid(root / "clean", root / "grid", root / "rep")
    harmonize(root / "grid", root / "harmonized", root / "rep", validation_dir=root / "validation")
    return root


@pytest.fixture(scope="module")
def client(data):
    return TestClient(create_app(Settings(data_dir=data, today=TODAY)))


def _export(client, **kw):
    return client.post("/api/export", json=kw)


def _tif(content: bytes):
    mem = MemoryFile(content)
    return mem, mem.open()


def _calendar_total(client, aoi, start, end, view="harmonized"):
    d = client.post("/api/calendar", json={"aoi": aoi, "start": start, "end": end, "view": view}).json()
    return sum(v for row in d["matrix"] for v in row if v is not None), d


def test_geotiff_sum(client):
    r = _export(client, aoi=NILE, what="grid", format="geotiff", start="2025-01", end="2025-12")
    assert r.status_code == 200
    assert r.headers["content-type"] == "image/tiff; application=geotiff; profile=cloud-optimized"
    assert r.headers["content-disposition"] == 'attachment; filename="almatafi_grid_2025-01_2025-12.tif"'
    mem, ds = _tif(r.content)
    with mem, ds:
        assert ds.tags(ns="IMAGE_STRUCTURE")["LAYOUT"] == "COG"
        assert ds.crs.to_epsg() == 4326 and ds.count == 1 and ds.dtypes == ("float32",) and ds.nodata == -1
        t = ds.transform
        assert (t.a, t.e, t.c, t.f) == (0.1, -0.1, 29.9, 31.6) and (ds.width, ds.height) == (24, 16)
        tags = ds.tags()
        assert {k: tags[k] for k in ("view", "metric", "start", "end")} == {
            "view": "harmonized", "metric": "detections", "start": "2025-01", "end": "2025-12"}
        assert tags["data_version"] == "mock-20261031" and "VIIRS-equivalent" in tags["unit"]
        band = ds.read(1)
    total, _ = _calendar_total(client, NILE, "2025-01", "2025-12")
    assert band[band >= 0].sum() == pytest.approx(total, abs=12)  # calendar rounds each month


def test_geotiff_pixels_are_grid_cells(client, data):
    r = _export(client, aoi=NILE, what="grid", format="geotiff", start="2024-10", end="2024-10")
    mem, ds = _tif(r.content)
    h = pd.read_parquet(data / "harmonized" / "harmonized_monthly.parquet")
    oct24 = h[(h["year"] == 2024) & (h["month"] == 10)].set_index("cell_id")["value"]
    with mem, ds:
        band = ds.read(1)
        checked = 0
        for row in range(ds.height):
            for col in range(ds.width):
                lon, lat = ds.xy(row, col)  # pixel centre
                cid = cells.cell_id(lat, lon)
                assert cells.cell_center(cid) == pytest.approx((lat, lon), abs=1e-9)
                assert band[row, col] == pytest.approx(oct24.get(cid, 0.0), abs=1e-3)
                checked += 1
    assert checked == 24 * 16


def test_geotiff_monthly_and_nodata_outside_the_shape(client):
    r = _export(client, aoi=TRIANGLE, what="grid", format="geotiff", start="2026-01", end="2026-10",
                aggregate="monthly")
    mem, ds = _tif(r.content)
    with mem, ds:
        assert ds.count == 10 and ds.descriptions == tuple(f"2026-{m:02d}" for m in range(1, 11))
        band = ds.read(10)
        assert (band == -1).any() and (band >= 0).any()
        corner_lon, corner_lat = ds.xy(0, 0)  # top-left corner is outside the triangle
        assert band[0, 0] == -1
    total, _ = _calendar_total(client, TRIANGLE, "2026-10", "2026-10")
    assert band[band >= 0].sum() == pytest.approx(total, abs=1)


def test_raw_view_grid_matches_the_calendar(client):
    r = _export(client, aoi=NILE, what="grid", format="geotiff", start="2015-01", end="2015-12", view="modis")
    mem, ds = _tif(r.content)
    with mem, ds:
        band = ds.read(1)
        assert "MODIS" in ds.tags()["unit"]
    total, _ = _calendar_total(client, NILE, "2015-01", "2015-12", view="modis")
    assert band[band >= 0].sum() == total


def test_grid_csv(client):
    s = _export(client, aoi=BOX, what="grid", format="csv", start="2025-01", end="2025-12")
    rows = list(csv.DictReader(io.StringIO(s.text)))
    assert list(rows[0]) == ["cell_id", "cell_lat", "cell_lon", "value"] and len(rows) == 42
    total, _ = _calendar_total(client, BOX, "2025-01", "2025-12")
    assert sum(float(r["value"]) for r in rows) == pytest.approx(total, abs=12)
    m = _export(client, aoi=BOX, what="grid", format="csv", start="2025-01", end="2025-03", aggregate="monthly")
    rows = list(csv.DictReader(io.StringIO(m.text)))
    assert list(rows[0]) == ["cell_id", "cell_lat", "cell_lon", "year", "month", "value"] and len(rows) == 42 * 3


def test_calendar_exports_match_calendar(client):
    _, cal = _calendar_total(client, NILE, "2024-06", "2025-03")
    j = _export(client, aoi=NILE, what="calendar", format="json", start="2024-06", end="2025-03").json()
    assert j["matrix"] == cal["matrix"] and j["origin"] == cal["origin"]
    c = _export(client, aoi=NILE, what="calendar", format="csv", start="2024-06", end="2025-03")
    assert c.headers["content-type"].startswith("text/csv")
    rows = list(csv.DictReader(io.StringIO(c.text)))
    assert [(r["year"], r["month"]) for r in rows][:2] == [("2024", "6"), ("2024", "7")] and len(rows) == 10
    assert int(rows[4]["value"]) == cal["matrix"][0][9] and rows[4]["origin"] == "observed_snpp"


@pytest.mark.parametrize("fmt", ["csv", "geojson"])
def test_hotspot_exports_have_every_point(client, fmt):
    body = {"aoi": BOX, "start": "2026-10-01", "end": "2026-10-31"}
    total = client.post("/api/hotspots", json=body | {"limit": 1}).json()["total"]
    r = _export(client, what="hotspots", format=fmt, **body)
    if fmt == "csv":
        rows = list(csv.DictReader(io.StringIO(r.text)))
        assert len(rows) == total and {"lat", "lon", "point_id", "frp"} <= set(rows[0])
    else:
        assert r.headers["content-type"] == "application/geo+json"
        assert len(r.json()["features"]) == total == r.json()["total"]
    assert r.headers["content-disposition"].endswith(f'almatafi_hotspots_2026-10-01_2026-10-31.{fmt}"')



def test_hotspot_kml(client):
    """X27: KML with one placemark per hotspot, its pixel footprint and a FIRMS credit."""
    import xml.etree.ElementTree as ET
    body = {"aoi": BOX, "start": "2026-10-01", "end": "2026-10-31"}
    total = client.post("/api/hotspots", json=body | {"limit": 1}).json()["total"]
    r = _export(client, what="hotspots", format="kml", **body)
    assert r.headers["content-type"].startswith("application/vnd.google-earth.kml+xml")
    assert r.headers["content-disposition"].endswith('almatafi_hotspots_2026-10-01_2026-10-31.kml"')
    ns = {"k": "http://www.opengis.net/kml/2.2"}
    root = ET.fromstring(r.content)
    marks = root.findall(".//k:Placemark", ns)
    assert len(marks) == total > 0
    assert "NASA FIRMS" in root.find("k:Document/k:description", ns).text
    ring = marks[0].find(".//k:Polygon//k:coordinates", ns).text.split()
    assert len(ring) == 5 and ring[0] == ring[-1]
    folders = {f.find("k:name", ns).text for f in root.findall(".//k:Folder", ns)}
    assert folders <= {"Terra", "Aqua", "SNPP", "NOAA20", "NOAA21"}


def test_footprint_size():
    from app.export import footprint
    ring = footprint(31.0, 30.0, 1.0, 1.0)
    w = (ring[1][0] - ring[0][0]) * 111.32 * 0.8660254
    h = (ring[2][1] - ring[1][1]) * 110.57
    assert abs(w - 1.0) < 1e-6 and abs(h - 1.0) < 1e-6
    assert footprint(31.0, 30.0, None, 0.4) is None


@pytest.mark.parametrize("kw,status,code", [
    ({"what": "grid", "format": "geojson", "start": "2025-01", "end": "2025-12"}, 400, "bad_request"),
    ({"what": "calendar", "format": "csv", "start": "2025-01-01", "end": "2025-12-31"}, 400, "bad_request"),
    ({"what": "hotspots", "format": "csv", "start": "2026-10", "end": "2026-10"}, 400, "bad_request"),
    ({"what": "grid", "format": "geotiff", "start": "2001-01", "end": "2026-10", "aggregate": "monthly"}, 422, "too_large"),
    ({"what": "grid", "format": "geotiff", "start": "2025-01", "end": "2025-02",
      "aoi": {"type": "bbox", "bbox": [179.5, -17.0, -179.5, -16.0]}}, 422, "invalid_aoi"),
    ({"what": "grid", "format": "csv", "start": "1999-01", "end": "2001-01"}, 422, "out_of_range"),
])
def test_export_errors(client, kw, status, code):
    r = _export(client, **({"aoi": NILE} | kw))
    assert (r.status_code, r.json()["error"]["code"]) == (status, code)


def test_grid_csv_for_an_area_without_fires(client):
    r = _export(client, aoi={"type": "bbox", "bbox": [0.0, 0.0, 0.5, 0.5]}, what="grid", format="csv",
                start="2025-01", end="2025-02")
    rows = list(csv.DictReader(io.StringIO(r.text)))
    assert r.status_code == 200 and len(rows) == 25 and {r["value"] for r in rows} == {"0.0"}


def test_validation_endpoint(client, data, tmp_path):
    v = client.get("/api/validation").json()
    assert v == json.loads((data / "validation" / "validation.json").read_text())
    r = TestClient(create_app(Settings(data_dir=tmp_path, today=TODAY))).get("/api/validation")
    assert r.status_code == 503 and r.json()["error"]["details"] == {"dataset": "validation"}


# --- security review fixes

def test_geotiff_pixel_cap(client):
    # Two small boxes on different continents: tiny area, huge extent (about 720 × 1,020 cells).
    spread = {"type": "polygon", "geometry": {"type": "MultiPolygon", "coordinates": [
        [[[31.0, 30.5], [31.6, 30.5], [31.6, 31.2], [31.0, 31.2], [31.0, 30.5]]],
        [[[-70.0, -41.0], [-69.4, -41.0], [-69.4, -40.3], [-70.0, -40.3], [-70.0, -41.0]]]]}}
    ok = _export(client, aoi=spread, what="grid", format="csv", start="2025-01", end="2025-12")
    assert ok.status_code == 200  # CSV only lists the AOI's cells
    r = _export(client, aoi=spread, what="grid", format="geotiff", start="2016-01", end="2025-12",
                aggregate="monthly")  # 120 bands → ~88M pixels
    assert r.status_code == 422 and r.json()["error"]["code"] == "too_large"
    assert r.json()["error"]["details"]["pixels"] > 30_000_000


def test_hotspot_export_point_cap(client, monkeypatch):
    import app.export as export
    monkeypatch.setattr(export, "MAX_EXPORT_POINTS", 10)
    r = _export(client, aoi=BOX, what="hotspots", format="csv", start="2026-10-01", end="2026-10-31")
    assert r.status_code == 422 and r.json()["error"]["details"]["limit_points"] == 10


def test_kml_has_its_own_lower_point_cap(client, monkeypatch):
    """KML takes ~4.7 KB of memory per point (940 MB at 200k, on an API capped at 1 GB)."""
    import app.export as export
    assert export.MAX_KML_POINTS <= 50_000
    monkeypatch.setattr(export, "MAX_KML_POINTS", 10)
    ask = dict(aoi=BOX, what="hotspots", start="2026-10-01", end="2026-10-31")
    r = _export(client, format="kml", **ask)
    assert r.status_code == 422 and r.json()["error"]["details"]["limit_points"] == 10
    assert "KML exports are limited to 10" in r.json()["error"]["message"]
    assert _export(client, format="csv", **ask).status_code == 200


def test_geotiff_pixel_cap_keeps_memory_down(client):
    # ~720 × 1,020 cells of extent: 12 monthly bands ≈ 8.8M pixels fit, 14 ≈ 10.3M don't
    # (30M took ~640 MB, close to the API's 1 GB cap).
    spread = {"type": "polygon", "geometry": {"type": "MultiPolygon", "coordinates": [
        [[[31.0, 30.5], [31.6, 30.5], [31.6, 31.2], [31.0, 31.2], [31.0, 30.5]]],
        [[[-70.0, -41.0], [-69.4, -41.0], [-69.4, -40.3], [-70.0, -40.3], [-70.0, -41.0]]]]}}
    ok = _export(client, aoi=spread, what="grid", format="geotiff", start="2025-01", end="2025-12",
                 aggregate="monthly")
    assert ok.status_code == 200
    r = _export(client, aoi=spread, what="grid", format="geotiff", start="2024-11", end="2025-12",
                aggregate="monthly")
    assert r.status_code == 422 and r.json()["error"]["details"]["limit_pixels"] == 10_000_000
