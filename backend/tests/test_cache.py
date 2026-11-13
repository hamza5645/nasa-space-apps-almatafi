import hashlib
import io
import json
import tarfile
from datetime import date

import httpx
import pytest
from fastapi.testclient import TestClient

from almatafi.grid import build as build_grid
from almatafi import clouds
from almatafi.harmonize.build import build as harmonize
from almatafi.ingest import ingest
from almatafi.mock.generate import firms_files, generate, write
from app.bootstrap import install
from app.cache import build_cache, main
from app.config import Settings
from app.main import create_app

TODAY = date(2026, 11, 2)


@pytest.fixture(scope="module")
def built(tmp_path_factory):
    root, end = tmp_path_factory.mktemp("x3"), date(2026, 10, 31)
    write(generate(seed=2026, end=end, regions=["nile-delta", "rio-negro"]), root / "raw", seed=2026, end=end,
          messy_year=None)
    files = firms_files(root / "raw")
    ingest(files, root / "clean", root / "rep", "mock", today=end)
    build_grid(root / "clean", root / "grid", root / "rep")
    harmonize(root / "grid", root / "harmonized", root / "rep", validation_dir=root / "validation")
    ids, last = clouds.grid_cmg_ids(root / "grid")
    clouds.write(clouds.build_mock(ids, last), root / "clouds", "mock")
    settings = Settings(data_dir=root, today=TODAY)
    index = build_cache(settings, root / "cache")
    return root, index, TestClient(create_app(settings))


def _load(root, name):
    return json.loads((root / "cache" / name).read_text())


def _no_time(d):
    """Responses minus the generation time, which differs between two calls."""
    d = json.loads(json.dumps(d))
    d.get("meta", {}).pop("generated_at", None)
    return d


def test_index(built):
    root, index, _ = built
    assert _load(root, "index.json") == index
    assert [r["region_id"] for r in index["regions"]] == ["nile-delta", "rio-negro"]
    assert index["data_version"] == "mock-20261031" and index["validation"] == "validation.json"
    for r in index["regions"]:
        assert r["bytes"] == (root / "cache" / r["file"]).stat().st_size < 5_000_000


@pytest.mark.parametrize("rid", ["nile-delta", "rio-negro"])
def test_cached_responses_equal_the_live_ones(built, rid):
    root, _, client = built
    doc = _load(root, f"{rid}.json")
    aoi = {"type": "region", "region_id": rid}
    assert doc["region"] == next(r for r in client.get("/api/regions").json()["regions"] if r["region_id"] == rid)
    for view in ("harmonized", "modis", "viirs"):
        for metric in ("detections", "fire_days"):
            live = client.post("/api/calendar", json={"aoi": aoi, "view": view, "metric": metric}).json()
            assert _no_time(doc["calendar"][view][metric]) == _no_time(live)
    for month in ("2001-01", "2012-02", doc["region"]["default_month"]):
        live = client.post("/api/stats", json={"aoi": aoi, "month": month}).json()
        assert _no_time(doc["stats"][month]) == _no_time(live)
    month = doc["region"]["default_month"]
    hot = doc["hotspots"][month]
    assert hot["type"] == "FeatureCollection" and hot["total"] == len(hot["features"]) > 0
    assert all(f["properties"]["acq_datetime_utc"].startswith(month) for f in hot["features"])


def test_stats_for_every_observed_month(built):
    root, _, _ = built
    doc = _load(root, "rio-negro.json")
    cal = doc["calendar"]["harmonized"]["detections"]
    observed = {f"{y}-{m:02d}" for y, row in zip(cal["years"], cal["matrix"]) for m, v in zip(cal["months"], row)
                if v is not None}
    assert set(doc["stats"]) == observed and len(observed) == 310
    assert doc["stats"]["2026-07"]["status"] == "unusual_high"  # CONAE's case is in the cache


def test_validation_copy(built):
    root, _, client = built
    assert _load(root, "validation.json") == client.get("/api/validation").json()


def test_cli(built, tmp_path):
    root, _, _ = built
    main(["--data", str(root), "--out", str(tmp_path / "c"), "--today", "2026-11-02"])
    assert sorted(p.name for p in (tmp_path / "c").iterdir()) == [
        "index.json", "nile-delta.json", "rio-negro.json", "validation.json"]


def test_real_bundle_without_cache_drops_the_mock_cache(tmp_path):
    data = tmp_path / "data"
    (data / "cache").mkdir(parents=True)
    (data / "cache" / "nile-delta.json").write_text("{mock}")
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        info = tarfile.TarInfo("harmonized/harmonized_monthly.parquet")
        info.size = 4
        tar.addfile(info, io.BytesIO(b"real"))
    body = buf.getvalue()
    install("https://data.example.org/b.tar.gz", hashlib.sha256(body).hexdigest(), data,
            httpx.MockTransport(lambda r: httpx.Response(200, content=body)))
    assert not (data / "cache").exists()


def test_cloud_corrected_copy(built):
    """X27: with a cloud product, the offline copy also holds the cloud-corrected calendar and stats."""
    root, _, client = built
    doc = _load(root, "rio-negro.json")
    aoi = {"type": "region", "region_id": "rio-negro"}
    live = client.post("/api/calendar", json={"aoi": aoi, "clouds": "correct"}).json()
    assert _no_time(doc["calendar_clouds"]) == _no_time(live) and live["clouds"]["source"] == "mock"
    assert set(doc["stats_clouds"]) == set(doc["stats"])
    month = doc["region"]["default_month"]
    live = client.post("/api/stats", json={"aoi": aoi, "month": month, "clouds": "correct"}).json()
    assert _no_time(doc["stats_clouds"][month]) == _no_time(live)
    assert doc["stats_clouds"][month]["value"] > doc["stats"][month]["value"]  # cloud only ever adds
