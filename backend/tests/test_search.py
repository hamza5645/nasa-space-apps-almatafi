import json
import math

import httpx
import pytest
import shapely
from fastapi.testclient import TestClient
from shapely.geometry import shape

from app.config import Settings
from app.main import create_app
from app.search import CACHE_TTL_S, Nominatim

KAFR = {
    "place_id": 1, "lat": "31.25", "lon": "30.94", "name": "Kafr El Sheikh", "addresstype": "state", "type": "administrative",
    "display_name": "Kafr El Sheikh, Egypt", "boundingbox": ["31.0", "31.6", "30.4", "31.4"],
    "geojson": {"type": "Polygon", "coordinates": [[[30.4, 31.0], [31.4, 31.0], [31.4, 31.6], [30.4, 31.6], [30.4, 31.0]]]},
}
TOWN = {"lat": "30.79", "lon": "31.00", "name": "", "type": "town", "display_name": "Tanta, Gharbia, Egypt",
        "boundingbox": ["30.7", "30.9", "30.9", "31.1"], "geojson": {"type": "Point", "coordinates": [31.0, 30.79]}}


class Fake:
    """A stand-in Nominatim: records requests, answers from a script."""

    def __init__(self, answer=lambda req: httpx.Response(200, json=[KAFR, TOWN])):
        self.requests, self.answer = [], answer
        self.now, self.slept = 1000.0, []

    def handler(self, request: httpx.Request):
        self.requests.append(request)
        return self.answer(request)

    def client(self) -> Nominatim:
        return Nominatim("https://nominatim.test/search", "almatafi/0.1 (test; ops@example.org)",
                         transport=httpx.MockTransport(self.handler), clock=lambda: self.now,
                         sleep=lambda s: self.slept.append(s))


def _app(tmp_path, fake: Fake) -> TestClient:
    app = create_app(Settings(data_dir=tmp_path))
    app.state.search = fake.client()
    return TestClient(app)


def test_results_follow_the_contract(tmp_path):
    fake = Fake()
    body = _app(tmp_path, fake).get("/api/search", params={"q": "Kafr El Sheikh", "limit": 5}).json()
    kafr, town = body["results"]
    geometry = kafr.pop("geometry")
    assert kafr == {"name": "Kafr El Sheikh", "display_name": "Kafr El Sheikh, Egypt", "kind": "state",
                    "centroid": [30.94, 31.25], "bbox": [30.4, 31.0, 31.4, 31.6]}  # [lon, lat]; [w, s, e, n]
    assert geometry["type"] == "Polygon" and shape(geometry).equals(shape(KAFR["geojson"]))
    assert town["name"] == "Tanta" and town["kind"] == "town" and town["geometry"] is None
    assert set(body["meta"]) == {"data_version", "generated_at"}


def test_request_respects_the_usage_policy(tmp_path):
    fake = Fake()
    _app(tmp_path, fake).get("/api/search", params={"q": "Tanta", "limit": 3})
    req = fake.requests[0]
    assert req.url.host == "nominatim.test"
    assert req.headers["user-agent"] == "almatafi/0.1 (test; ops@example.org)"
    assert dict(req.url.params) == {"q": "Tanta", "format": "jsonv2", "limit": "3", "polygon_geojson": "1",
                                    "polygon_threshold": "0.001", "accept-language": "en"}


def test_one_request_per_second():
    fake = Fake()
    n = fake.client()
    n.search("a", 5)
    fake.now += 0.3
    n.search("b", 5)
    assert fake.slept == [pytest.approx(0.7)]
    fake.now += 5
    n.search("c", 5)
    assert len(fake.slept) == 1


def test_cache_for_24_hours_ignoring_case_and_spaces():
    fake = Fake()
    n = fake.client()
    n.search("Kafr El Sheikh", 5)
    n.search("  kafr   el sheikh ", 5)
    assert len(fake.requests) == 1
    n.search("Kafr El Sheikh", 3)            # another limit is another query
    assert len(fake.requests) == 2
    fake.now += CACHE_TTL_S + 1
    n.search("Kafr El Sheikh", 5)
    assert len(fake.requests) == 3


def test_big_polygons_are_simplified():
    ring = [[31 + 0.5 * math.cos(a), 31 + 0.5 * math.sin(a)] for a in (2 * math.pi * i / 6000 for i in range(6000))]
    ring.append(ring[0])
    big = KAFR | {"geojson": {"type": "Polygon", "coordinates": [ring]}}
    fake = Fake(lambda req: httpx.Response(200, json=[big]))
    geom = fake.client().search("x", 1)[0]["geometry"]
    g = shape(geom)
    assert shapely.get_num_coordinates(g) <= 2000 and g.is_valid
    assert g.area == pytest.approx(shape(big["geojson"]).area, rel=0.01)


@pytest.mark.parametrize("answer", [
    lambda req: httpx.Response(503, text="busy"),
    lambda req: httpx.Response(200, text="<html>not json</html>"),
    lambda req: httpx.Response(200, json={"error": "nope"}),
    lambda req: httpx.Response(200, json=[{"lat": "1"}]),
    lambda req: (_ for _ in ()).throw(httpx.ConnectTimeout("slow")),
])
def test_upstream_failures_are_502(tmp_path, answer):
    r = _app(tmp_path, Fake(answer)).get("/api/search", params={"q": "Tanta"})
    assert r.status_code == 502 and r.json()["error"] == {
        "code": "upstream_error", "message": "Place search is unavailable right now; try again shortly.",
        "details": {"upstream": "nominatim"}}


def test_failures_are_not_cached():
    calls = {"n": 0}

    def flaky(req):
        calls["n"] += 1
        return httpx.Response(503) if calls["n"] == 1 else httpx.Response(200, json=[KAFR])

    fake = Fake(flaky)
    n = fake.client()
    with pytest.raises(Exception):
        n.search("Kafr", 5)
    fake.now += 2
    assert n.search("Kafr", 5)[0]["name"] == "Kafr El Sheikh"


@pytest.mark.parametrize("params", [{}, {"q": ""}, {"q": "   "}, {"q": "x" * 201}, {"q": "a", "limit": 11},
                                    {"q": "a", "limit": 0}])
def test_bad_queries_are_400(tmp_path, params):
    fake = Fake()
    r = _app(tmp_path, fake).get("/api/search", params=params)
    assert r.status_code == 400 and r.json()["error"]["code"] == "bad_request"
    assert fake.requests == []


def test_real_app_identifies_itself(tmp_path):
    app = create_app(Settings(data_dir=tmp_path, contact="ops@example.org"))
    ua = app.state.search.client.headers["user-agent"]
    assert ua.startswith("almatafi/0.1") and "ops@example.org" in ua
    assert json.dumps(ua)  # plain text


# --- security review fixes

def test_many_tiny_parts_terminate_under_the_cap():
    squares = [[[[x * 0.01, y * 0.01], [x * 0.01 + 0.005, y * 0.01], [x * 0.01 + 0.005, y * 0.01 + 0.005],
                  [x * 0.01, y * 0.01 + 0.005], [x * 0.01, y * 0.01]]] for x in range(40) for y in range(40)]
    item = KAFR | {"geojson": {"type": "MultiPolygon", "coordinates": squares}}  # 1,600 parts, 8,000 points
    fake = Fake(lambda req: httpx.Response(200, json=[item]))
    geom = shape(fake.client().search("x", 1)[0]["geometry"])
    assert shapely.get_num_coordinates(geom) <= 2000 and geom.geom_type in ("Polygon", "MultiPolygon")


def test_lock_is_not_held_during_the_request():
    fake = Fake()
    n = fake.client()

    def check(req):
        assert not n.lock.locked()  # other searches can use the cache meanwhile
        return httpx.Response(200, json=[KAFR])

    fake.answer = check
    assert n.search("Kafr", 1)[0]["name"] == "Kafr El Sheikh"


def test_slots_are_booked_and_a_long_queue_is_refused():
    fake = Fake()
    n = fake.client()
    n.last_request = fake.now + 2.5        # three requests already booked ahead of us
    n.search("a", 1)
    assert fake.slept == [pytest.approx(3.5)]
    n.last_request = fake.now + 10         # the queue is too long: fail fast
    with pytest.raises(Exception) as e:
        n.search("b", 1)
    assert e.value.status == 502 and "busy" in e.value.message


def test_a_place_across_180_gets_a_crossing_bbox(tmp_path):
    """Nominatim's own bbox for Fiji is [-180, s, 180, n]; the answer's bbox hugs the parts."""
    fiji = {"lat": "-17.8", "lon": "178.0", "name": "Fiji", "addresstype": "country", "display_name": "Fiji",
            "boundingbox": ["-21.9", "-12.3", "-180", "180"],
            "geojson": {"type": "MultiPolygon", "coordinates": [
                [[[177.0, -18.5], [179.9, -18.5], [179.9, -16.0], [177.0, -16.0], [177.0, -18.5]]],
                [[[-180.0, -17.0], [-178.5, -17.0], [-178.5, -16.2], [-180.0, -16.2], [-180.0, -17.0]]]]}}
    fake = Fake(lambda req: httpx.Response(200, json=[fiji, KAFR]))
    fj, kafr = _app(tmp_path, fake).get("/api/search", params={"q": "Fiji"}).json()["results"]
    assert fj["bbox"] == [177.0, -18.5, -178.5, -16.0]  # west > east: crosses 180°
    assert kafr["bbox"] == [30.4, 31.0, 31.4, 31.6]  # untouched
