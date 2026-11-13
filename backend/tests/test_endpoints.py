from datetime import date

import numpy as np
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq
import pytest
import shapely
from fastapi.testclient import TestClient
from shapely.geometry import Polygon

from almatafi import cells
from almatafi.grid import build
from almatafi.ingest import ingest
from almatafi.mock.generate import firms_files, generate, write
from app import analytics
from app.config import Settings
from app.main import create_app

TODAY = date(2026, 11, 2)
RIO = {"type": "region", "region_id": "rio-negro"}
NILE_BOX = {"type": "bbox", "bbox": [31.0, 30.5, 31.6, 31.2]}


def _pipeline(root, end, regions):
    write(generate(seed=2026, end=end, regions=regions), root / "raw", seed=2026, end=end, messy_year=None)
    files = firms_files(root / "raw")
    ingest(files, root / "clean", root / "reports", "mock", today=end)
    build(root / "clean", root / "grid", root / "reports")
    return root


@pytest.fixture(scope="module")
def data(tmp_path_factory):
    return _pipeline(tmp_path_factory.mktemp("data"), date(2026, 10, 31), ["rio-negro", "nile-delta"])


@pytest.fixture(scope="module")
def client(data):
    return TestClient(create_app(Settings(data_dir=data, today=TODAY)))


def _post(client, path, **body):
    return client.post(f"/api/{path}", json=body)


# --- /calendar

def test_calendar_viirs_shape_and_nulls(client):
    d = _post(client, "calendar", aoi=RIO, start="2010-01", end="2026-10", view="viirs").json()
    assert d["years"] == list(range(2010, 2027)) and d["months"] == list(range(1, 13))
    assert len(d["matrix"]) == 17 and all(len(r) == 12 for r in d["matrix"])
    assert "origin" not in d and d["unit"] == "VIIRS detections per month (S-NPP; NOAA-20 after S-NPP ended)"
    by_year = dict(zip(d["years"], d["matrix"]))
    assert all(v is None for v in by_year[2011]) and by_year[2012][0] is None  # null before 2012-02
    assert by_year[2012][1] is not None
    assert by_year[2026][10:] == [None, None]                                  # after `end`
    assert all(isinstance(v, int) for row in d["matrix"] for v in row if v is not None)
    for total, row in zip(d["year_totals"], d["matrix"]):
        vals = [v for v in row if v is not None]
        assert total == (sum(vals) if vals else None)
    assert d["max"] == max(v for row in d["matrix"] for v in row if v is not None)
    assert d["partial_month"] is None
    assert d["meta"]["aoi"]["cells"] == 38 * 23


def test_calendar_matches_the_grid(client, data):
    d = _post(client, "calendar", aoi=RIO, start="2015-01", end="2015-12", view="modis").json()
    g = pd.read_parquet(data / "grid" / "grid_monthly.parquet")
    w, s, e, n = -71.8, -41.8, -68.0, -39.5
    rows, cols = g["cell_id"] // 3600, g["cell_id"] % 3600
    lat, lon = (2 * rows + 1 - 1800) / 20, (2 * cols + 1 - 3600) / 20
    inside = lat.between(s, n) & lon.between(w, e)
    # Raw MODIS is Aqua alone from July 2002: adding Terra would double the series when Aqua starts.
    want = g[inside & (g["year"] == 2015) & (g["platform"] == "Aqua")].groupby("month")["detections"].sum()
    assert d["matrix"][0] == [int(want.get(m, 0)) for m in range(1, 13)]


def test_raw_modis_has_no_jump_when_aqua_starts(client, data):
    """Terra only until June 2002, then Aqua only: the same one-satellite series throughout."""
    d = _post(client, "calendar", aoi=RIO, start="2002-01", end="2002-12", view="modis").json()
    g = pd.read_parquet(data / "grid" / "grid_monthly.parquet")
    rows, cols = g["cell_id"] // 3600, g["cell_id"] % 3600
    lat, lon = (2 * rows + 1 - 1800) / 20, (2 * cols + 1 - 3600) / 20
    g = g[lat.between(-41.8, -39.5) & lon.between(-71.8, -68.0) & (g["year"] == 2002)]
    by = g.groupby(["platform", "month"])["detections"].sum()
    want = [int(by.get(("Aqua" if m >= 7 else "Terra", m), 0)) for m in range(1, 13)]
    assert d["unit"].startswith("MODIS detections per month (Aqua; Terra")
    assert d["matrix"][0] == want


def test_calendar_fire_days_never_exceed_detections(client):
    det = _post(client, "calendar", aoi=RIO, start="2013-01", end="2020-12", view="viirs").json()["matrix"]
    fd = _post(client, "calendar", aoi=RIO, start="2013-01", end="2020-12", view="viirs", metric="fire_days").json()["matrix"]
    assert all(b <= a for ra, rb in zip(det, fd) for a, b in zip(ra, rb))


def test_calendar_defaults_and_partial_month(client):
    d = _post(client, "calendar", aoi=RIO, view="modis").json()
    assert d["years"][0] == 2001 and d["years"][-1] == 2026
    assert d["partial_month"] == {"month": "2026-11", "days_observed": 0}
    assert d["matrix"][-1][10] is None  # no data yet this month


@pytest.mark.parametrize("body,status,code", [
    ({"start": "1999-01", "end": "2001-01"}, 422, "out_of_range"),
    ({"start": "2001-01", "end": "2027-01"}, 422, "out_of_range"),
    ({"start": "2010-05", "end": "2010-01"}, 400, "bad_request"),
    ({"start": "2010-13", "end": "2011-01"}, 400, "bad_request"),
    ({"view": "goes"}, 400, "bad_request"),
])
def test_calendar_errors(client, body, status, code):
    r = _post(client, "calendar", aoi=RIO, **body)
    assert (r.status_code, r.json()["error"]["code"]) == (status, code)


def test_calendar_area_limit(client):
    r = _post(client, "calendar", aoi={"type": "bbox", "bbox": [0, -40, 60, 40]})
    assert r.status_code == 422 and r.json()["error"]["code"] == "too_large"


def test_harmonized_missing_is_503(client):
    r = _post(client, "calendar", aoi=RIO)
    assert r.status_code == 503 and r.json()["error"]["code"] == "data_unavailable"


def _harmonized_client(tmp_path, extra_meta=None):
    c1, c2 = cells.cell_id(30.55, 31.05), cells.cell_id(30.65, 31.15)
    rows = [  # cell, year, month, value, fire_days, origin
        (c1, 2001, 3, 2.5, 1.0, "converted_terra"), (c2, 2001, 3, 1.0, 1.0, "converted_terra"),
        (c1, 2010, 10, 40.4, 6.0, "converted_aqua"), (c2, 2010, 10, 0.2, 0.2, "converted_aqua"),
        (c1, 2022, 8, 7.0, 3.0, "filled_noaa20"), (c1, 2022, 8, 1.0, 1.0, "observed_snpp"),
    ]
    table = pa.table({
        "cell_id": pa.array([r[0] for r in rows], pa.int32()), "year": pa.array([r[1] for r in rows], pa.int16()),
        "month": pa.array([r[2] for r in rows], pa.int8()), "value": pa.array([r[3] for r in rows], pa.float32()),
        "value_fire_days": pa.array([r[4] for r in rows], pa.float32()),
        "origin": [r[5] for r in rows], "stratum_id": [None] * 6, "model": [None] * 6,
    }).replace_schema_metadata({b"data_version": b"mock-20261102", b"covered_start": b"2001-01",
                                b"covered_end": b"2026-10", **(extra_meta or {})})
    (tmp_path / "harmonized").mkdir()
    pq.write_table(table, tmp_path / "harmonized" / "harmonized_monthly.parquet")
    return TestClient(create_app(Settings(data_dir=tmp_path, today=TODAY)))


@pytest.fixture
def harmonized(tmp_path):
    return _harmonized_client(tmp_path)


def test_harmonized_months_nobody_observed_are_null(tmp_path):
    """A month no platform observed is "not observed", never 0 (which would read as below normal)."""
    import json
    origins = {f"{y}-{m:02d}": "observed_snpp" for y in range(2012, 2027) for m in range(1, 13)}
    origins["2015-03"] = None
    c = _harmonized_client(tmp_path, {b"month_origins": json.dumps(origins).encode()})
    d = _post(c, "calendar", aoi=NILE_BOX, start="2015-01", end="2015-12").json()
    assert d["matrix"][0][:4] == [0, 0, None, 0] and d["origin"][0][2] is None
    assert _post(c, "stats", aoi=NILE_BOX, month="2015-03").status_code == 422


def test_harmonized_calendar(harmonized):
    d = _post(harmonized, "calendar", aoi=NILE_BOX, start="2000-11", end="2026-11").json()
    by_year = dict(zip(d["years"], d["matrix"]))
    origin = dict(zip(d["years"], d["origin"]))
    assert by_year[2000][10] is None                       # before covered_start
    assert by_year[2001][2] == 4                            # 2.5 + 1.0 = 3.5 → 4 (half up)
    assert by_year[2001][3] == 0 and origin[2001][3] == "converted_terra"   # covered, nothing there
    assert by_year[2010][9] == 41 and origin[2010][9] == "converted_aqua"
    assert by_year[2022][7] == 8 and origin[2022][7] == "filled_noaa20"     # the larger part wins
    assert by_year[2015][0] == 0 and origin[2015][0] == "observed_snpp"
    assert by_year[2026][10] is None and origin[2026][10] is None           # after covered_end
    assert d["unit"] == "VIIRS-equivalent detections per month"
    fd = _post(harmonized, "calendar", aoi=NILE_BOX, start="2010-10", end="2010-10", metric="fire_days").json()
    assert fd["matrix"][0][9] == 6


def test_harmonized_stats(harmonized):
    s = _post(harmonized, "stats", aoi=NILE_BOX, month="2010-10", baseline=[2001, 2009]).json()
    assert s["value"] == 40.6 and s["baseline"]["n_years"] == 9
    assert s["baseline"]["sd"] == 0.0 and s["z"] is None and s["status"] == "unusual_high"



def _clouds(root, rows, source=b"mock"):
    """Cloud product rows: (cmg cell of a 0.1° cell, year, month, platform, cloud fraction)."""
    from almatafi import clouds
    table = pa.table({"cmg_id": pa.array([int(clouds.cmg_of_cell(r[0])) for r in rows], pa.int32()),
                      "year": pa.array([r[1] for r in rows], pa.int16()), "month": pa.array([r[2] for r in rows], pa.int8()),
                      "platform": [r[3] for r in rows], "cloud_fraction": pa.array([r[4] for r in rows], pa.float32())})
    (root / "clouds").mkdir()
    pq.write_table(table.replace_schema_metadata({b"source": source}), root / "clouds" / "cloud_monthly.parquet")


def test_cloud_cover_and_correction(tmp_path):
    """X27: every calendar says how cloudy each month was; clouds=correct divides each cell's
    count by its clear share (floored at 0.2), using Aqua's pass, Terra's before July 2002."""
    c = _harmonized_client(tmp_path)
    c1 = cells.cell_id(30.55, 31.05)  # both fixture cells share this 0.5° cloud cell
    _clouds(tmp_path, [(c1, 2010, 10, "Aqua", 0.5),
                       (c1, 2010, 10, "Terra", 0.0),     # ignored: Aqua's pass stands for 2010
                       (c1, 2001, 3, "Terra", 0.9)])     # cloudier than the floor allows
    plain = _post(c, "calendar", aoi=NILE_BOX, start="2001-01", end="2010-12").json()
    by_year = dict(zip(plain["years"], plain["cloud"]))
    assert plain["clouds"]["mode"] == "off" and plain["clouds"]["source"] == "mock" and plain["clouds"]["note"]
    assert by_year[2010][9] == 0.5 and by_year[2001][2] == 0.9 and by_year[2005][0] is None
    assert dict(zip(plain["years"], plain["matrix"]))[2010][9] == 41

    fixed = _post(c, "calendar", aoi=NILE_BOX, start="2001-01", end="2010-12", clouds="correct").json()
    m = dict(zip(fixed["years"], fixed["matrix"]))
    assert m[2010][9] == 81        # (40.4 + 0.2) / 0.5 = 81.2
    assert m[2001][2] == 18        # (2.5 + 1.0) / max(0.1, 0.2) = 17.5 → 18 (half up): at most 5×
    assert m[2005][0] is None      # no cloud data that month: not observed, never left uncorrected
    assert fixed["unit"].endswith("corrected for cloud cover") and fixed["clouds"]["mode"] == "correct"

    s = _post(c, "stats", aoi=NILE_BOX, month="2010-10", baseline=[2001, 2009], clouds="correct").json()
    assert s["value"] == 81.2 and s["cloud_fraction"] == 0.5 and s["clouds"]["mode"] == "correct"
    assert _post(c, "stats", aoi=NILE_BOX, month="2010-10").json()["cloud_fraction"] == 0.5

    bad = _post(c, "calendar", aoi=NILE_BOX, metric="fire_days", clouds="correct")
    assert bad.status_code == 422 and "detections" in bad.json()["error"]["message"]


def test_cloud_correction_never_mixes_corrected_and_uncorrected_months(tmp_path):
    """The real cloud product trails the fire data by months. A month it doesn't reach can't be
    corrected; compared as it is with corrected months it would read as below normal."""
    c = _harmonized_client(tmp_path)
    c1 = cells.cell_id(30.55, 31.05)
    _clouds(tmp_path, [(c1, y, 10, "Aqua", 0.5) for y in range(2005, 2010)])   # stops before 2010
    ask = dict(aoi=NILE_BOX, month="2010-10", baseline=[2001, 2009])
    r = _post(c, "stats", **ask, clouds="correct")
    assert r.status_code == 422 and r.json()["error"]["code"] == "out_of_range"
    assert r.json()["error"]["details"] == {"month": "2010-10", "dataset": "clouds"}
    assert _post(c, "stats", **ask).json()["value"] == 40.6                    # as seen, it still answers
    cal = _post(c, "calendar", aoi=NILE_BOX, start="2009-01", end="2010-12", clouds="correct").json()
    assert cal["matrix"][0][9] == 0 and cal["matrix"][1][9] is None

    (tmp_path / "clouds" / "cloud_monthly.parquet").unlink()
    (tmp_path / "clouds").rmdir()
    _clouds(tmp_path, [(c1, y, 10, "Aqua", 0.5) for y in range(2005, 2011)])
    s = _post(c, "stats", **ask, clouds="correct").json()
    assert s["value"] == 81.2 and s["baseline"]["n_years"] == 5                # 2001–2004 have no cloud data


def test_exports_follow_the_cloud_correction(tmp_path):
    """The file has the numbers on the screen, and its value column says they are corrected."""
    import rasterio
    from rasterio.io import MemoryFile
    c = _harmonized_client(tmp_path)
    _clouds(tmp_path, [(cells.cell_id(30.55, 31.05), 2010, 10, "Aqua", 0.5)])
    ask = dict(aoi=NILE_BOX, start="2010-10", end="2010-10")
    plain = _post(c, "export", **ask, what="calendar", format="csv").text.splitlines()
    assert plain == ["year,month,value,origin", "2010,10,41,converted_aqua"]
    fixed = _post(c, "export", **ask, what="calendar", format="csv", clouds="correct").text.splitlines()
    assert fixed == ["year,month,value_cloud_corrected,origin", "2010,10,81,converted_aqua"]
    grid = _post(c, "export", **ask, what="grid", format="csv", clouds="correct").text.splitlines()
    assert grid[0] == "cell_id,cell_lat,cell_lon,value_cloud_corrected"
    assert sum(float(ln.split(",")[3]) for ln in grid[1:]) == pytest.approx(81.2, abs=0.01)
    tif = _post(c, "export", **ask, what="grid", format="geotiff", clouds="correct")
    with MemoryFile(tif.content) as mem, mem.open() as ds:
        band = ds.read(1)
        assert ds.tags()["unit"].endswith("corrected for cloud cover")
        assert band[band != ds.nodata].sum() == pytest.approx(81.2, abs=0.01)
    bad = _post(c, "export", **ask, what="grid", format="csv", view="modis", clouds="correct")
    assert bad.status_code == 422


def test_no_cloud_product_no_cloud_fields(harmonized):
    d = _post(harmonized, "calendar", aoi=NILE_BOX, start="2010-01", end="2010-12").json()
    assert "cloud" not in d and "clouds" not in d
    s = _post(harmonized, "stats", aoi=NILE_BOX, month="2010-10").json()
    assert "cloud_fraction" not in s
    r = _post(harmonized, "calendar", aoi=NILE_BOX, clouds="correct")
    assert r.status_code == 503 and r.json()["error"]["details"]["dataset"] == "clouds"


def test_cloud_correction_is_harmonized_only(client):
    r = _post(client, "calendar", aoi=RIO, start="2020-01", end="2020-12", view="viirs", clouds="correct")
    assert r.status_code == 422

# --- /stats

def test_stats_rio_negro_july_2026(client):
    s = _post(client, "stats", aoi=RIO, month="2026-07", view="viirs").json()
    b = s["baseline"]
    assert b["years"] == [2001, 2025]
    years = [v["year"] for v in b["values"]]
    assert 2026 not in years and years == list(range(2012, 2026)) and b["n_years"] == 14
    vals = np.array([v["value"] for v in b["values"]])
    assert s["percentile"] == 100 and s["rank"] == 1 and s["status"] == "unusual_high"
    assert s["z"] == pytest.approx((s["value"] - vals.mean()) / vals.std(ddof=1), abs=0.1)
    assert s["ratio_to_median"] == pytest.approx(s["value"] / np.median(vals), abs=0.1)
    assert s["partial"] is None and s["trend"]["series"] == "annual_totals"


def test_stats_agrees_with_calendar(client):
    cal = _post(client, "calendar", aoi=RIO, start="2001-01", end="2025-12", view="modis").json()
    col = {y: row[2] for y, row in zip(cal["years"], cal["matrix"])}  # March
    s = _post(client, "stats", aoi=RIO, month="2020-03", view="modis", baseline=[2005, 2015]).json()
    assert s["value"] == col[2020]
    assert [(v["year"], v["value"]) for v in s["baseline"]["values"]] == [(y, col[y]) for y in range(2005, 2016)]


@pytest.mark.parametrize("body,status,code", [
    ({"month": "2005-07", "view": "viirs"}, 422, "out_of_range"),     # VIIRS didn't exist
    ({"month": "2026-12"}, 422, "out_of_range"),                       # future
    ({"month": "2020-07", "baseline": [2020, 2010]}, 422, "out_of_range"),
    ({"month": "July"}, 400, "bad_request"),
])
def test_stats_errors(client, body, status, code):
    r = _post(client, "stats", aoi=RIO, **({"view": "modis"} | body))
    assert (r.status_code, r.json()["error"]["code"]) == (status, code)


def test_stats_partial_month_compares_same_days(tmp_path):
    root = _pipeline(tmp_path, date(2026, 10, 15), ["rio-negro"])
    c = TestClient(create_app(Settings(data_dir=root, today=date(2026, 10, 15))))
    s = _post(c, "stats", aoi=RIO, month="2026-10", view="viirs").json()
    # The mock ends on Oct 15; quiet days have no SNPP points, but other platforms reach day 15.
    assert s["partial"] == {"days_observed": 15, "comparison": "same_days_previous_years"}
    cal = _post(c, "calendar", aoi=RIO, start="2026-01", end="2026-10", view="viirs").json()
    assert cal["partial_month"] == {"month": "2026-10", "days_observed": 15}
    full = _post(c, "calendar", aoi=RIO, start="2012-01", end="2025-12", view="viirs").json()
    october = {y: row[9] for y, row in zip(full["years"], full["matrix"])}
    scaled = {v["year"]: v["value"] for v in s["baseline"]["values"]}
    assert all(scaled[y] <= october[y] + 0.05 for y in scaled)
    assert sum(scaled.values()) < 0.8 * sum(october[y] for y in scaled)


# --- /hotspots

def _hot(client, **kw):
    body = {"aoi": NILE_BOX, "start": "2026-10-01", "end": "2026-10-31"} | kw
    return client.post("/api/hotspots", json=body)


def test_hotspots_shape_and_order(client):
    d = _hot(client, limit=50).json()
    assert d["type"] == "FeatureCollection" and d["total"] > 50 and d["truncated"] is True
    assert len(d["features"]) == 50
    props = d["features"][0]["properties"]
    assert set(props) == {"point_id", "sensor", "platform", "acq_datetime_utc", "daynight", "frp",
                          "confidence_class", "confidence_pct", "fire_type", "brightness_k", "scan_km",
                          "track_km", "cell_id", "source"}
    times = [f["properties"]["acq_datetime_utc"] for f in d["features"]]
    assert times == sorted(times, reverse=True) and times[0].endswith("Z")
    for f in d["features"]:
        lon, lat = f["geometry"]["coordinates"]
        assert 31.0 <= lon <= 31.6 and 30.5 <= lat <= 31.2
        assert f["properties"]["cell_id"] == cells.cell_id(lat, lon)
        assert "2026-10-01" <= f["properties"]["acq_datetime_utc"][:10] <= "2026-10-31"


def test_hotspots_filter(client):
    kept = _hot(client, limit=50000).json()
    everything = _hot(client, limit=50000, include_filtered=True).json()
    assert everything["total"] > kept["total"]
    for f in kept["features"]:
        p = f["properties"]
        assert p["confidence_class"] != "low" and p["fire_type"] in (0, None)
        if p["sensor"] == "MODIS":
            assert p["confidence_pct"] >= 30


def test_hotspots_inside_a_triangle(client):
    tri = [[30.5, 30.5], [32.0, 30.5], [31.25, 31.5], [30.5, 30.5]]
    d = _hot(client, aoi={"type": "polygon", "geometry": {"type": "Polygon", "coordinates": [tri]}},
             limit=50000).json()
    shape = Polygon(tri)
    pts = np.array([f["geometry"]["coordinates"] for f in d["features"]])
    assert len(pts) > 0 and shapely.contains_xy(shape, pts[:, 0], pts[:, 1]).all()


def test_hotspots_sensor_choice(client):
    d = _hot(client, sensors=["VIIRS"], limit=50000).json()
    assert {f["properties"]["sensor"] for f in d["features"]} == {"VIIRS"}


def test_hotspots_one_platform_matches_the_calendar(client):
    """Three VIIRS satellites see the same fires; S-NPP alone is what the calendar counts."""
    rio = {"aoi": RIO, "start": "2026-07-01", "end": "2026-07-31", "limit": 50000}
    every = _post(client, "hotspots", **rio).json()
    snpp = _post(client, "hotspots", **rio, platforms=["SNPP"]).json()
    cal = _post(client, "calendar", aoi=RIO, start="2026-07", end="2026-07", view="viirs").json()
    assert every["total"] == sum(every["by_platform"].values()) and len(every["by_platform"]) >= 3
    assert snpp["total"] == every["by_platform"]["SNPP"] == cal["matrix"][0][6]
    assert {f["properties"]["platform"] for f in snpp["features"]} == {"SNPP"}
    assert snpp["by_platform"] == every["by_platform"]


@pytest.mark.parametrize("kw,status,code", [
    ({"start": "2025-01-01", "end": "2026-10-31"}, 422, "too_large"),
    ({"start": "2026-10-31", "end": "2026-10-01"}, 400, "bad_request"),
    ({"aoi": {"type": "bbox", "bbox": [20, 0, 30, 10]}}, 422, "too_large"),
    ({"limit": 60000}, 400, "bad_request"),
    ({"sensors": []}, 400, "bad_request"),
    ({"sensors": ["GOES"]}, 400, "bad_request"),
    ({"platforms": ["Landsat"]}, 400, "bad_request"),
])
def test_hotspots_errors(client, kw, status, code):
    r = _hot(client, **kw)
    assert (r.status_code, r.json()["error"]["code"]) == (status, code)


def test_hotspots_without_points(tmp_path):
    r = _hot(TestClient(create_app(Settings(data_dir=tmp_path, today=TODAY))))
    assert r.status_code == 503 and r.json()["error"]["code"] == "data_unavailable"


# --- analytics

def test_compare_definitions():
    base = [(2001, 1.0), (2002, 2.0), (2003, 3.0), (2004, 4.0)]
    c = analytics.compare(3.0, base)
    assert c["percentile"] == 50 and c["rank"] == 2              # 2 of 4 strictly lower; 4 is higher
    assert c["z"] == round((3.0 - 2.5) / np.std([1, 2, 3, 4], ddof=1), 1)
    assert c["status"] == "normal" and c["ratio_to_median"] == 1.2


@pytest.mark.parametrize("z,status", [(2.0, "unusual_high"), (1.99, "above_normal"), (1.0, "above_normal"),
                                      (0.5, "normal"), (-0.99, "normal"), (-1.0, "below_normal")])
def test_status_thresholds(z, status):
    assert analytics.status_for(z, 0, 0) == status


def test_short_baseline_has_no_status():
    """One past year can't say what normal is: 18 against a single 17 is not "unusual"."""
    assert analytics.compare(18, [(2025, 17.0)])["status"] is None
    assert analytics.compare(85, [(2024, 17.0), (2025, 17.0)])["status"] is None
    assert analytics.compare(85, [(2023, 17.0), (2024, 18.0), (2025, 16.0)])["status"] == "unusual_high"


def test_trend():
    up = [(y, 10 + 3 * (y - 2001)) for y in range(2001, 2016)]
    t = analytics.trend(up)
    assert t["sen_slope_per_year"] == 3.0 and t["p_value"] < 0.001
    flat = analytics.trend([(y, 5.0) for y in range(2001, 2010)])
    assert flat["sen_slope_per_year"] == 0.0 and flat["p_value"] == 1.0
    assert analytics.trend([(2001, 1.0), (2002, 2.0)]) is None


def test_round_half_up():
    assert [analytics.round_half_up(x) for x in (0.5, 1.5, 2.5, 2.49)] == [1, 2, 3, 2]


# --- security review fixes

def test_errors_do_not_reveal_server_paths(tmp_path):
    c = TestClient(create_app(Settings(data_dir=tmp_path, today=TODAY)))
    for path, body in [("calendar", {"aoi": RIO}), ("calendar", {"aoi": RIO, "view": "modis"}),
                       ("hotspots", {"aoi": NILE_BOX, "start": "2026-10-01", "end": "2026-10-02"})]:
        r = c.post(f"/api/{path}", json=body)
        assert r.status_code == 503
        assert str(tmp_path) not in r.text and "/" not in str(r.json()["error"]["details"])


def test_hotspots_match_a_brute_force_count(client, data):
    from almatafi.ingest import read_clean
    tri = [[30.53, 30.52], [31.97, 30.58], [31.21, 31.47], [30.53, 30.52]]  # edges cut through cells
    d = _hot(client, aoi={"type": "polygon", "geometry": {"type": "Polygon", "coordinates": [tri]}},
             include_filtered=True, limit=50000).json()
    pts = read_clean(data / "clean")
    pts = pts[(pts["acq_datetime_utc"] >= "2026-10-01") & (pts["acq_datetime_utc"] < "2026-11-01")]
    inside = shapely.contains_xy(Polygon(tri), pts["lon"].to_numpy(), pts["lat"].to_numpy())
    assert d["total"] == int(inside.sum()) > 0


def test_hotspots_refuse_thin_slivers(client):
    sliver = [[-60, -40], [60, 40], [60, 40.0001], [-60, -40]]  # tiny area, huge bbox
    r = _hot(client, aoi={"type": "polygon", "geometry": {"type": "Polygon", "coordinates": [sliver]}})
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_aoi"


def test_hotspots_across_the_antimeridian(client):
    r = _hot(client, aoi={"type": "bbox", "bbox": [179.5, -17.0, -179.5, -16.0]})
    assert r.status_code == 200 and r.json()["total"] == 0


def test_hotspots_row_cap(client, monkeypatch):
    import app.routes as routes
    monkeypatch.setattr(routes, "MAX_HOTSPOT_ROWS", 10)
    r = _hot(client)
    assert r.status_code == 422 and r.json()["error"]["code"] == "too_large"
