"""X6: POST /api/nrt against a fake FIRMS area API. Nothing here touches the network."""

import logging
from datetime import date, timedelta

import httpx
import pandas as pd
import pytest
import shapely
from fastapi.testclient import TestClient

from almatafi import cells
from app.config import Settings
from app.main import create_app
from app.nrt import BUDGET, CACHE_TTL_S, Firms, boxes, windows

KEY = "0123456789abcdef0123456789abcdef"
TODAY = date(2026, 11, 3)
DELTA = {"type": "bbox", "bbox": [30.5, 30.5, 31.5, 31.5]}
VIIRS_HEAD = ("latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,"
              "version,bright_ti5,frp,daynight\n")
MODIS_HEAD = ("latitude,longitude,brightness,scan,track,acq_date,acq_time,satellite,instrument,confidence,"
              "version,bright_t31,frp,daynight\n")


def viirs(lat, lon, day="2026-11-02", time="1104", sat="N", conf="n", frp="4.20"):
    return f"{lat},{lon},331.20,0.41,0.38,{day},{time},{sat},VIIRS,{conf},2.0NRT,290.10,{frp},D\n"


def modis(lat, lon, day="2026-11-01", time="842", conf="83"):
    return f"{lat},{lon},315.60,1.12,1.06,{day},{time},Terra,MODIS,{conf},6.1NRT,297.68,7.25,D\n"


class FakeFirms:
    """Answers by source name; records every call as (source, area, days, date)."""

    def __init__(self, bodies=None, status=200):
        self.bodies, self.status, self.calls = bodies or {}, status, []

    def handler(self, request: httpx.Request):
        parts = request.url.path.split("/")  # /api/area/csv/KEY/SOURCE/AREA/DAYS/DATE
        assert parts[:4] == ["", "api", "area", "csv"] and parts[4] == KEY
        assert request.url.host == "firms.modaps.eosdis.nasa.gov" and request.url.scheme == "https"
        self.calls.append((parts[5], parts[6], int(parts[7]), parts[8]))
        return httpx.Response(self.status, content=self.bodies.get(parts[5], "").encode())


@pytest.fixture
def fake():
    return FakeFirms({
        "VIIRS_SNPP_NRT": VIIRS_HEAD + viirs(30.9, 31.0) + viirs(30.95, 31.05, time="1110", conf="l")
                          + viirs(29.0, 31.0),  # outside the AOI (the bbox query is only a prefilter)
        "VIIRS_NOAA20_NRT": VIIRS_HEAD + viirs(31.2, 31.3, day="2026-11-03", time="5", sat="N20"),
        "VIIRS_NOAA21_NRT": "",  # FIRMS sends nothing when nothing burned
        "MODIS_NRT": MODIS_HEAD + modis(30.8, 30.9) + modis(30.7, 30.6, conf="12"),
    })


def _client(tmp_path, fake, key=KEY, clock=None):
    app = create_app(Settings(data_dir=tmp_path, firms_map_key=key, today=TODAY))
    app.state.firms = Firms(key, transport=httpx.MockTransport(fake.handler), clock=clock or (lambda: 0.0))
    return TestClient(app), app


def test_windows_and_boxes():
    assert windows(TODAY, 1) == [(TODAY, 1)]
    assert windows(TODAY, 7) == [(date(2026, 10, 28), 5), (date(2026, 11, 2), 2)]
    assert sum(n for _, n in windows(TODAY, 10)) == 10
    assert boxes(shapely.box(30, 29, 33, 32)) == [(30, 29, 33, 32)]
    split = shapely.MultiPolygon([shapely.box(179, -10, 180, 10), shapely.box(-180, -10, -179, 10)])
    assert sorted(boxes(split)) == [(-180, -10, -179, 10), (179, -10, 180, 10)]
    islands = shapely.MultiPolygon([shapely.box(x, -18, x + 0.2, -17) for x in (177, 178, 179.5, -179.9, -179)])
    assert sorted(boxes(islands)) == [(-179.9, -18, -178.8, -17), (177, -18, 179.7, -17)]


def test_feature_times_are_utc_whatever_the_frame_says():
    from types import SimpleNamespace

    from app.routes import feature
    row = dict(point_id="x", sensor="VIIRS", platform="SNPP", daynight="D", frp=1.0, confidence_class="nominal",
               confidence_pct=None, fire_type=None, brightness_k=300.0, scan_km=0.4, track_km=0.4, cell_id=1,
               source="nrt", lat=30.0, lon=31.0)
    local = pd.Timestamp("2026-11-03T02:05:00", tz="Africa/Cairo")  # = 00:05 UTC
    assert feature(SimpleNamespace(**row, acq_datetime_utc=local))["properties"]["acq_datetime_utc"] == \
        "2026-11-03T00:05:00Z"


def test_live_points_look_like_archive_points(tmp_path, fake):
    c, _ = _client(tmp_path, fake)
    r = c.post("/api/nrt", json={"aoi": DELTA, "days": 7})
    assert r.status_code == 200
    d = r.json()
    assert d["type"] == "FeatureCollection" and d["source"] == "nrt" and "fetched_at" in d["meta"]
    # 3 VIIRS sources + MODIS, 2 windows each (7 days = 5 + 2).
    assert len(fake.calls) == 8 and {c[1] for c in fake.calls} == {"30.5,30.5,31.5,31.5"}
    assert {(c[2], c[3]) for c in fake.calls} == {(5, "2026-10-28"), (2, "2026-11-02")}
    # Low-confidence VIIRS, MODIS conf 12 and the point outside the AOI are left out.
    assert d["total"] == 3 and not d["truncated"]
    props = [f["properties"] for f in d["features"]]
    times = [p["acq_datetime_utc"] for p in props]
    assert times == sorted(times, reverse=True) and times[0] == "2026-11-03T00:05:00Z"
    assert {p["platform"] for p in props} == {"SNPP", "NOAA20", "Terra"}
    first = props[0]
    assert first["source"] == "nrt" and first["fire_type"] is None and first["confidence_class"] == "nominal"
    assert first["cell_id"] == cells.cell_id(31.2, 31.3)
    assert d["features"][0]["geometry"]["coordinates"] == [31.3, 31.2]

    all_ = c.post("/api/nrt", json={"aoi": DELTA, "days": 7, "include_filtered": True}).json()
    assert all_["total"] == 5


def test_sensors_limit_and_cache(tmp_path, fake):
    now = [0.0]
    c, _ = _client(tmp_path, fake, clock=lambda: now[0])
    d = c.post("/api/nrt", json={"aoi": DELTA, "days": 3, "sensors": ["VIIRS"], "limit": 1}).json()
    assert d["total"] == 2 and d["truncated"] and len(d["features"]) == 1
    assert {c[0] for c in fake.calls} == {"VIIRS_SNPP_NRT", "VIIRS_NOAA20_NRT", "VIIRS_NOAA21_NRT"}
    calls = len(fake.calls)
    c.post("/api/nrt", json={"aoi": DELTA, "days": 3, "sensors": ["VIIRS"]})
    assert len(fake.calls) == calls                      # cached
    now[0] += CACHE_TTL_S + 1
    c.post("/api/nrt", json={"aoi": DELTA, "days": 3, "sensors": ["VIIRS"]})
    assert len(fake.calls) == 2 * calls                  # expired


def test_static_mask_applies(tmp_path, fake):
    (tmp_path / "grid").mkdir()
    pd.DataFrame({"cell_id": pd.array([cells.cell_id(30.9, 31.0)], "int32"),
                  "months_flagged": [12]}).to_parquet(tmp_path / "grid" / "static_mask.parquet")
    c, _ = _client(tmp_path, fake)
    d = c.post("/api/nrt", json={"aoi": DELTA, "days": 7}).json()
    assert d["total"] == 2
    assert all(f["properties"]["cell_id"] != cells.cell_id(30.9, 31.0) for f in d["features"])


def test_not_configured_and_limits(tmp_path, fake):
    c, _ = _client(tmp_path, fake, key=None)
    r = c.post("/api/nrt", json={"aoi": DELTA})
    assert r.status_code == 503 and r.json()["error"]["code"] == "data_unavailable"
    assert c.get("/api/health").json()["sources"]["nrt"] is False

    c, _ = _client(tmp_path, fake)
    for body in ({"aoi": DELTA, "days": 0}, {"aoi": DELTA, "days": 11}, {"aoi": DELTA, "sensors": []}):
        assert c.post("/api/nrt", json=body).status_code == 400
    big = c.post("/api/nrt", json={"aoi": {"type": "bbox", "bbox": [20, 20, 40, 40]}})
    assert big.status_code == 422 and big.json()["error"]["code"] == "too_large"
    assert fake.calls == []


@pytest.mark.parametrize("fake_answer", [
    FakeFirms({"MODIS_NRT": "Invalid MAP_KEY."}),
    FakeFirms({"MODIS_NRT": "<html>Down for maintenance</html>"}),
    FakeFirms(status=500),
])
def test_upstream_failures_never_leak_the_key(tmp_path, caplog, fake_answer):
    c, _ = _client(tmp_path, fake_answer)
    with caplog.at_level(logging.WARNING):
        r = c.post("/api/nrt", json={"aoi": DELTA, "days": 1, "sensors": ["MODIS"]})
    assert r.status_code == 502 and r.json()["error"]["code"] == "upstream_error"
    assert KEY not in r.text and KEY not in caplog.text


def test_network_error_is_502(tmp_path):
    def boom(request):
        raise httpx.ConnectError("no route", request=request)
    app = create_app(Settings(data_dir=tmp_path, firms_map_key=KEY, today=TODAY))
    app.state.firms = Firms(KEY, transport=httpx.MockTransport(boom))
    r = TestClient(app).post("/api/nrt", json={"aoi": DELTA, "days": 1})
    assert r.status_code == 502 and KEY not in r.text


def test_transaction_budget(tmp_path, fake):
    now = [0.0]
    c, app = _client(tmp_path, fake, clock=lambda: now[0])
    app.state.firms.spent.extend([0.0] * (BUDGET - 2))
    r = c.post("/api/nrt", json={"aoi": DELTA, "days": 1})          # needs 4 calls, 2 left
    assert r.status_code == 503 and r.json()["error"]["code"] == "upstream_busy" and fake.calls == []
    now[0] += 601                                                   # the window has passed
    assert c.post("/api/nrt", json={"aoi": DELTA, "days": 1}).status_code == 200


def test_thin_shape_with_a_huge_bbox_is_refused(tmp_path, fake):
    """Small area, near-global bbox: FIRMS is queried by bbox, so this must not go out."""
    sliver = {"type": "Polygon", "coordinates": [[[-170, -60], [170, 60], [170, 60.05], [-170, -59.95], [-170, -60]]]}
    c, _ = _client(tmp_path, fake)
    r = c.post("/api/nrt", json={"aoi": {"type": "polygon", "geometry": sliver}, "days": 1})
    assert r.status_code == 422 and r.json()["error"]["code"] == "too_large" and fake.calls == []
    assert "bbox_area_km2" in r.json()["error"]["details"]  # the area itself passed; the bbox didn't


def test_oversized_answer_is_cut_off(tmp_path, monkeypatch):
    from app import nrt as nrt_module
    monkeypatch.setattr(nrt_module, "MAX_BYTES", 1000)
    big = FakeFirms({"MODIS_NRT": MODIS_HEAD + modis(30.8, 30.9) * 50})
    c, _ = _client(tmp_path, big)
    r = c.post("/api/nrt", json={"aoi": DELTA, "days": 1, "sensors": ["MODIS"]})
    assert r.status_code == 502


def test_cache_holds_only_points_inside_the_shape(tmp_path, fake):
    c, app = _client(tmp_path, fake)
    c.post("/api/nrt", json={"aoi": DELTA, "days": 7, "include_filtered": True})
    (_, df, _), = app.state.firms.cache.values()
    assert len(df) == 5 and df["lat"].between(30.5, 31.5).all()


# --- X10: on-demand hotspots for areas without stored points.

from app.nrt import plan  # noqa: E402

AVAIL = ("data_id,min_date,max_date\nMODIS_SP,2000-11-01,2026-06-30\nVIIRS_SNPP_SP,2012-01-20,2026-05-31\n"
         "MODIS_NRT,2026-05-01,2026-11-03\n")


class FakeArchive:
    """Area API + data_availability. Answers rows dated inside each request's window."""

    def __init__(self, avail=AVAIL, avail_status=200):
        self.avail, self.avail_status, self.calls = avail, avail_status, []

    def handler(self, request: httpx.Request):
        parts = request.url.path.split("/")
        if parts[2] == "data_availability":
            self.calls.append(("availability",))
            return httpx.Response(self.avail_status, content=self.avail.encode())
        source, days, first = parts[5], int(parts[7]), date.fromisoformat(parts[8])
        self.calls.append((source, days, first))
        if source.startswith("MODIS"):
            ver = "6.1" if source.endswith("_SP") else "6.1NRT"
            rows = "".join(modis(10.5, 20.5, day=(first + timedelta(days=i)).isoformat(), conf="80")
                           for i in range(days))
            return httpx.Response(200, content=(MODIS_HEAD + rows.replace("6.1NRT", ver)).encode())
        return httpx.Response(200, content=b"")


def test_plan_splits_standard_and_nrt_and_skips_satellites_not_yet_flying():
    calls = plan(["MODIS", "VIIRS"], date(2026, 5, 28), date(2026, 6, 3), sp_until=date(2026, 5, 31))
    assert ("MODIS_SP", date(2026, 5, 28), 4) in calls and ("MODIS_NRT", date(2026, 6, 1), 3) in calls
    assert {c[0] for c in calls} == {"MODIS_SP", "MODIS_NRT", "VIIRS_SNPP_SP", "VIIRS_NOAA20_SP", "VIIRS_NOAA21_SP",
                                     "VIIRS_SNPP_NRT", "VIIRS_NOAA20_NRT", "VIIRS_NOAA21_NRT"}
    old = plan(["MODIS", "VIIRS"], date(2015, 7, 1), date(2015, 7, 31), sp_until=date(2026, 5, 31))
    assert {c[0] for c in old} == {"MODIS_SP", "VIIRS_SNPP_SP"}      # no NOAA-20/21 in 2015, no NRT
    assert sum(n for src, _, n in old if src == "MODIS_SP") == 31


def _archive_client(tmp_path, fake, key=KEY):
    app = create_app(Settings(data_dir=tmp_path, firms_map_key=key, today=TODAY))
    app.state.firms = Firms(key, transport=httpx.MockTransport(fake.handler), clock=lambda: 0.0)
    return TestClient(app)


ELSEWHERE = {"type": "bbox", "bbox": [20.0, 10.0, 21.0, 11.0]}


def test_hotspots_elsewhere_come_from_firms(tmp_path):
    fake = FakeArchive()
    c = _archive_client(tmp_path, fake)
    r = c.post("/api/hotspots", json={"aoi": ELSEWHERE, "start": "2026-06-25", "end": "2026-07-08", "sensors": ["MODIS"]})
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["on_demand"] is True and d["total"] > 0
    # MODIS standard data up to MODIS_SP's own last day (06-30, not S-NPP's 05-31), NRT after it.
    sources = [x[0] for x in fake.calls if x[0] != "availability"]
    assert set(sources) == {"MODIS_SP", "MODIS_NRT"}
    labels = {f["properties"]["acq_datetime_utc"][:10]: f["properties"]["source"] for f in d["features"]}
    assert labels["2026-06-25"] == "archive" and labels["2026-07-05"] == "nrt"
    assert all("2026-06-25" <= day <= "2026-07-08" for day in labels)
    # data_availability is asked once and cached.
    c.post("/api/hotspots", json={"aoi": ELSEWHERE, "start": "2026-04-01", "end": "2026-04-10", "sensors": ["MODIS"]})
    assert sum(1 for x in fake.calls if x[0] == "availability") == 1


def test_plan_uses_each_sources_own_standard_end():
    ends = {"MODIS_SP": date(2025, 1, 31), "VIIRS_SNPP_SP": date(2025, 2, 28), "VIIRS_NOAA20_SP": date(2025, 2, 28),
            "VIIRS_NOAA21_SP": date(2025, 2, 28)}
    calls = plan(["VIIRS"], date(2025, 2, 10), date(2025, 2, 14), ends)
    assert {c[0] for c in calls} == {"VIIRS_SNPP_SP", "VIIRS_NOAA20_SP", "VIIRS_NOAA21_SP"}   # no NRT: still standard
    # S-NPP stopped on 2026-11-02: nothing is asked for after that.
    late = plan(["VIIRS"], date(2026, 11, 1), date(2026, 11, 5), ends)
    snpp = [c for c in late if c[0].startswith("VIIRS_SNPP")]
    assert sum(n for _, _, n in snpp) == 2 and {c[0] for c in late} >= {"VIIRS_NOAA20_NRT", "VIIRS_NOAA21_NRT"}


def test_availability_failure_falls_back_to_the_usual_lag(tmp_path):
    fake = FakeArchive(avail_status=500)
    c = _archive_client(tmp_path, fake)
    d = c.post("/api/hotspots", json={"aoi": ELSEWHERE, "start": "2026-06-25", "end": "2026-07-10",
                                      "sensors": ["MODIS"]}).json()
    # today 2026-11-03 − 120 days = 2026-07-06: standard up to then, NRT after.
    firsts = {(src, first) for src, *rest in fake.calls if src != "availability" for first in [rest[1]]}
    assert ("MODIS_SP", date(2026, 6, 25)) in firsts and ("MODIS_NRT", date(2026, 7, 7)) in firsts
    assert d["on_demand"] is True


def test_long_spans_and_no_key_keep_the_old_answers(tmp_path):
    fake = FakeArchive()
    c = _archive_client(tmp_path, fake)
    r = c.post("/api/hotspots", json={"aoi": ELSEWHERE, "start": "2026-01-01", "end": "2026-03-31"})
    assert r.status_code == 503 and r.json()["error"]["code"] == "data_unavailable" and fake.calls == []
    c = _archive_client(tmp_path, fake, key=None)
    r = c.post("/api/hotspots", json={"aoi": ELSEWHERE, "start": "2026-06-01", "end": "2026-06-07"})
    assert r.status_code == 503 and fake.calls == []


def test_on_demand_hotspots_export_too(tmp_path):
    c = _archive_client(tmp_path, FakeArchive())
    r = c.post("/api/export", json={"aoi": ELSEWHERE, "what": "hotspots", "format": "csv",
                                    "start": "2026-06-01", "end": "2026-06-05", "sensors": ["MODIS"]})
    assert r.status_code == 200 and r.text.count("\n") == 6  # header + one point per day
