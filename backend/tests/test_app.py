from datetime import date

import pytest
from fastapi.testclient import TestClient

from almatafi.grid import build
from almatafi.ingest import ingest
from almatafi.mock.generate import firms_files, generate, write
from app.config import Settings
from app.main import create_app


def _client(data_dir, **kw) -> TestClient:
    return TestClient(create_app(Settings(data_dir=data_dir, cors_origins=("http://localhost:3000",), **kw)))


@pytest.fixture(scope="module")
def mock_data(tmp_path_factory):
    root = tmp_path_factory.mktemp("data")
    end = date(2026, 10, 31)
    write(generate(seed=2026, end=end, regions=["rio-negro"]), root / "raw", seed=2026, end=end, messy_year=None)
    files = firms_files(root / "raw")
    ingest(files, root / "clean", root / "reports", "mock", today=date(2026, 11, 2))
    build(root / "clean", root / "grid", root / "reports")
    return root


def test_health_without_data(tmp_path):
    r = _client(tmp_path).get("/api/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok" and body["data_version"] == "none"
    assert body["sources"] == {"harmonized": False, "points": False, "nrt": False}
    assert isinstance(body["uptime_s"], int)


def test_health_with_mock_data(mock_data):
    body = _client(mock_data, firms_map_key="test-key").get("/api/health").json()
    assert body["data_version"] == "mock-20261102"
    assert body["sources"] == {"harmonized": False, "points": True, "nrt": True}
    assert "test-key" not in str(body)


def test_regions(tmp_path):
    body = _client(tmp_path).get("/api/regions").json()
    ids = [r["region_id"] for r in body["regions"]]
    assert ids == ["nile-delta", "rio-negro"]
    nile = body["regions"][0]
    assert nile["default_month"] == "2026-10" and nile["geometry"]["type"] == "Polygon"
    assert set(body["meta"]) == {"data_version", "generated_at"}
    assert body["meta"]["generated_at"].endswith("Z")


def test_unknown_route_uses_error_shape(tmp_path):
    r = _client(tmp_path).get("/api/nope")
    assert r.status_code == 404
    assert r.json()["error"]["code"] == "not_found"


def test_cors_allows_the_frontend(tmp_path):
    r = _client(tmp_path).options("/api/health", headers={
        "Origin": "http://localhost:3000", "Access-Control-Request-Method": "GET"})
    assert r.headers["access-control-allow-origin"] == "http://localhost:3000"
    r = _client(tmp_path).options("/api/health", headers={
        "Origin": "https://evil.example", "Access-Control-Request-Method": "GET"})
    assert "access-control-allow-origin" not in r.headers


def test_docs_are_served(tmp_path):
    assert _client(tmp_path).get("/api/openapi.json").status_code == 200


def test_error_shapes_for_bad_bodies(tmp_path):
    # B2's endpoints take an `aoi` body; a stand-in route checks the 400 and 422 shapes now.
    from pydantic import BaseModel

    from app.aoi import Aoi, resolve

    class Body(BaseModel):
        aoi: Aoi

    app = create_app(Settings(data_dir=tmp_path))

    @app.post("/api/_probe")
    def probe(body: Body):
        return resolve(body.aoi, app.state.regions, app.state.admin).meta()

    client = TestClient(app)
    r = client.post("/api/_probe", json={"aoi": {"type": "circle"}})
    assert r.status_code == 400 and r.json()["error"]["code"] == "bad_request"
    r = client.post("/api/_probe", content=b"{not json")
    assert r.status_code == 400 and r.json()["error"]["code"] == "bad_request"
    r = client.post("/api/_probe", content=b"{not json", headers={"content-type": "application/json"})
    assert r.status_code == 400 and r.json()["error"]["message"] == "body: JSON decode error"  # not the offset
    r = client.post("/api/_probe", json={"aoi": {"type": "bbox", "bbox": [0, 1, 1, 0]}})
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_aoi"
    r = client.post("/api/_probe", json={"aoi": {"type": "region", "region_id": "x"}})
    assert r.status_code == 404 and r.json()["error"]["details"] == {"region_id": "x"}
    r = client.post("/api/_probe", json={"aoi": {"type": "region", "region_id": "rio-negro"}})
    assert r.status_code == 200 and r.json()["cells"] == 38 * 23


def test_wrong_method_keeps_the_allow_header(tmp_path):
    r = _client(tmp_path).post("/api/health")
    assert r.status_code == 405 and r.json()["error"]["code"] == "bad_request"
    assert r.headers["allow"] == "GET"
