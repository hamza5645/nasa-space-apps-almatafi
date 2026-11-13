import json
import math

import httpx
import pytest
import shapely
from fastapi.testclient import TestClient
from shapely.geometry import shape

from app.admin import MAX_BYTES, GeoBoundaries
from app.config import Settings
from app.main import create_app

API = "https://www.geoboundaries.org/api/current/gbOpen"
FILE = "https://github.com/wmgeolab/geoBoundaries/raw/9469f09/releaseData/gbOpen/EGY/ADM1/geoBoundaries-EGY-ADM1_simplified.geojson"


def _square(x, y, d=0.5):
    return {"type": "Polygon", "coordinates": [[[x, y], [x + d, y], [x + d, y + d], [x, y + d], [x, y]]]}


EGY_ADM1 = {"type": "FeatureCollection", "features": [
    {"type": "Feature", "properties": {"shapeName": "Kafr El Sheikh", "shapeID": "EGY-ADM1-001", "shapeISO": "EG-KFS"},
     "geometry": _square(30.5, 31.0)},
    {"type": "Feature", "properties": {"shapeName": "Gharbia", "shapeID": "EGY-ADM1-002"},
     "geometry": _square(30.8, 30.6, 0.4)},
    {"type": "Feature", "properties": {"shapeName": "A point", "shapeID": "EGY-ADM1-003"},
     "geometry": {"type": "Point", "coordinates": [31, 30]}},
]}


class Fake:
    def __init__(self, routes=None):
        self.routes = routes or {f"{API}/EGY/ADM1/": httpx.Response(200, json={"simplifiedGeometryGeoJSON": FILE}),
                                 FILE: httpx.Response(200, json=EGY_ADM1)}
        self.requests = []

    def handler(self, request: httpx.Request):
        self.requests.append(str(request.url))
        answer = self.routes.get(str(request.url))
        return answer(request) if callable(answer) else (answer or httpx.Response(404))


def _client(tmp_path, fake: Fake) -> TestClient:
    app = create_app(Settings(data_dir=tmp_path))
    app.state.boundaries = GeoBoundaries(API, tmp_path / "admin", transport=httpx.MockTransport(fake.handler))
    return TestClient(app)


def test_boundaries_follow_the_contract(tmp_path):
    fake = Fake()
    d = _client(tmp_path, fake).get("/api/admin", params={"country": "egy", "level": 1}).json()
    assert d["type"] == "FeatureCollection" and len(d["features"]) == 2  # the point is dropped
    assert d["features"][0]["properties"] == {"admin_id": "EGY-ADM1-001", "name": "Kafr El Sheikh",
                                              "level": 1, "country": "EGY"}
    assert set(d["meta"]) == {"data_version", "generated_at"}
    assert fake.requests == [f"{API}/EGY/ADM1/", FILE]


def test_fetched_once_then_served_from_disk(tmp_path):
    fake = Fake()
    c = _client(tmp_path, fake)
    c.get("/api/admin", params={"country": "EGY", "level": 1})
    c.get("/api/admin", params={"country": "EGY", "level": 1})
    assert len(fake.requests) == 2
    assert json.loads((tmp_path / "admin" / "EGY_ADM1.geojson").read_text())["features"][1]["properties"]["name"] == "Gharbia"
    fresh = _client(tmp_path, Fake({}))  # a restarted server needs no network
    assert len(fresh.get("/api/admin", params={"country": "EGY", "level": 1}).json()["features"]) == 2


def test_fetched_boundaries_work_as_aois(tmp_path):
    c = _client(tmp_path, Fake())
    aoi = {"aoi": {"type": "admin", "admin_id": "EGY-ADM1-002"}, "start": "2025-01", "end": "2025-02", "view": "modis"}
    assert c.post("/api/calendar", json=aoi).json()["error"]["code"] == "not_found"
    c.get("/api/admin", params={"country": "EGY", "level": 1})
    r = c.post("/api/calendar", json=aoi)
    # Known now; this empty data folder has no grid, so the answer is "data unavailable", not "not found".
    assert r.status_code == 503
    restarted = create_app(Settings(data_dir=tmp_path))
    assert restarted.state.admin.get("EGY-ADM1-002") is not None


def test_big_polygons_are_simplified(tmp_path):
    ring = [[31 + 0.4 * math.cos(a), 30.8 + 0.4 * math.sin(a)] for a in (2 * math.pi * i / 5000 for i in range(5000))]
    ring.append(ring[0])
    doc = {"type": "FeatureCollection", "features": [
        {"type": "Feature", "properties": {"shapeName": "Round", "shapeID": "EGY-ADM1-009"},
         "geometry": {"type": "Polygon", "coordinates": [ring]}}]}
    fake = Fake({f"{API}/EGY/ADM1/": httpx.Response(200, json=[{"simplifiedGeometryGeoJSON": FILE}]),
                 FILE: httpx.Response(200, json=doc)})
    g = shape(_client(tmp_path, fake).get("/api/admin", params={"country": "EGY"}).json()["features"][0]["geometry"])
    assert shapely.get_num_coordinates(g) <= 2000


@pytest.mark.parametrize("params", [{}, {"country": "EG"}, {"country": "EGYP"}, {"country": "../x"},
                                    {"country": "EGY", "level": 3}, {"country": "EGY", "level": -1}])
def test_bad_queries_are_400(tmp_path, params):
    fake = Fake()
    r = _client(tmp_path, fake).get("/api/admin", params=params)
    assert r.status_code == 400 and fake.requests == []


def test_unknown_country_is_404(tmp_path):
    r = _client(tmp_path, Fake()).get("/api/admin", params={"country": "XXX", "level": 1})
    assert r.status_code == 404 and r.json()["error"]["code"] == "not_found"


@pytest.mark.parametrize("url", ["http://github.com/x.geojson",          # not https
                                 "https://evil.example/x.geojson",        # not an allowed host
                                 "https://github.com.evil.example/x.geojson",
                                 "https://169.254.169.254/latest/meta-data"])
def test_downloads_only_from_allowed_hosts(tmp_path, url):
    fake = Fake({f"{API}/EGY/ADM1/": httpx.Response(200, json={"simplifiedGeometryGeoJSON": url}),
                 url: httpx.Response(200, json=EGY_ADM1)})
    r = _client(tmp_path, fake).get("/api/admin", params={"country": "EGY", "level": 1})
    assert r.status_code == 502 and r.json()["error"]["code"] == "upstream_error"
    assert url not in fake.requests  # blocked before anything was sent


def test_redirects_are_checked_too(tmp_path):
    fake = Fake({f"{API}/EGY/ADM1/": httpx.Response(200, json={"simplifiedGeometryGeoJSON": FILE}),
                 FILE: httpx.Response(302, headers={"Location": "https://evil.example/steal"})})
    r = _client(tmp_path, fake).get("/api/admin", params={"country": "EGY", "level": 1})
    assert r.status_code == 502 and "https://evil.example/steal" not in fake.requests


def test_oversized_files_are_refused(tmp_path):
    big = b"x" * (MAX_BYTES + 1)
    fake = Fake({f"{API}/EGY/ADM1/": httpx.Response(200, json={"simplifiedGeometryGeoJSON": FILE}),
                 FILE: httpx.Response(200, content=big)})
    r = _client(tmp_path, fake).get("/api/admin", params={"country": "EGY", "level": 1})
    assert r.status_code == 502 and not (tmp_path / "admin" / "EGY_ADM1.geojson").exists()


@pytest.mark.parametrize("answer", [httpx.Response(500), httpx.Response(200, text="not json")])
def test_upstream_failures_are_502(tmp_path, answer):
    fake = Fake({f"{API}/EGY/ADM1/": answer})
    r = _client(tmp_path, fake).get("/api/admin", params={"country": "EGY", "level": 1})
    assert r.status_code == 502 and r.json()["error"]["details"] == {"upstream": "geoboundaries"}


def test_a_polygon_with_a_spike_keeps_its_shape():
    """make_valid turns it into polygons + a line; the polygon part must survive."""
    from shapely.geometry import shape

    from app.geometry import simplify_polygon

    spike = {"type": "Polygon", "coordinates": [[[0, 0], [2, 0], [2, 1], [3, 1], [2, 1], [2, 2], [0, 2], [0, 0]]]}
    out = simplify_polygon(spike)
    assert out is not None and out["type"] == "Polygon"
    assert shape(out).area == 4.0
