import json

from app.openapi import PATH, snapshot


def test_openapi_snapshot_is_current():
    assert PATH.read_text() == snapshot(), "API shape changed: run `python -m app.openapi` and commit contracts/openapi.json"


def test_every_endpoint_is_in_the_schema():
    paths = json.loads(PATH.read_text())["paths"]
    assert set(paths) == {"/api/health", "/api/regions", "/api/calendar", "/api/stats", "/api/hotspots",
                          "/api/nrt", "/api/export", "/api/validation", "/api/search", "/api/admin",
                          "/api/alerts/preview"}  # X27
