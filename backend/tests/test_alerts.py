"""X27: scratch "unusual month" alerts. Nothing is sent; the outbox is a folder of .eml files."""

import email
from datetime import date, datetime, timezone

import pyarrow as pa
import pyarrow.parquet as pq
import pytest
from fastapi.testclient import TestClient

from almatafi import cells
from app import alerts
from app.config import Settings
from app.main import create_app

BOX = {"type": "bbox", "bbox": [31.0, 30.5, 31.6, 31.2]}


def _client(root, today, spike=60.0):
    """Octobers 2001–2025 around 10, October 2026 = `spike`; covered to 2026-10."""
    c = cells.cell_id(30.55, 31.05)
    rows = [(y, 10, 10.0 + (y % 5)) for y in range(2001, 2026)] + [(2026, 10, spike), (2026, 9, 3.0)]
    table = pa.table({
        "cell_id": pa.array([c] * len(rows), pa.int32()), "year": pa.array([r[0] for r in rows], pa.int16()),
        "month": pa.array([r[1] for r in rows], pa.int8()), "value": pa.array([r[2] for r in rows], pa.float32()),
        "value_fire_days": pa.array([1.0] * len(rows), pa.float32()), "origin": ["observed_snpp"] * len(rows),
        "stratum_id": [None] * len(rows), "model": [None] * len(rows),
    }).replace_schema_metadata({b"data_version": b"mock-20261102", b"covered_start": b"2001-01",
                                b"covered_end": b"2026-10"})
    (root / "harmonized").mkdir(exist_ok=True)
    pq.write_table(table, root / "harmonized" / "harmonized_monthly.parquet")
    return TestClient(create_app(Settings(data_dir=root, today=today)))


def test_preview_falls_back_to_last_month_and_escapes(tmp_path):
    c = _client(tmp_path, date(2026, 11, 2))  # November has no data yet → October
    r = c.post("/api/alerts/preview", json={"aoi": BOX, "name": "<b>Delta</b>  farms"})
    d = r.json()
    assert r.status_code == 200 and d["month"] == "2026-10" and d["status"] == "unusual_high"
    assert d["triggered"] and d["sent"] is False and "no email is sent" in d["note"]
    e = d["email"]
    assert e["subject"] == "Fire alert: <b>Delta</b> farms is unusually high in October 2026"
    assert "<b>Delta" not in e["html"] and "&lt;b&gt;Delta" in e["html"]       # escaped in HTML
    assert "60 VIIRS-equivalent hotspots" in e["text"] and "NASA FIRMS" in e["text"]


def test_threshold(tmp_path):
    c = _client(tmp_path, date(2026, 11, 2), spike=12.5)  # a little above the Octobers' mean
    d = c.post("/api/alerts/preview", json={"aoi": BOX, "threshold": "unusual_high"}).json()
    assert d["status"] in ("normal", "above_normal") and not d["triggered"]
    assert d["email"]["subject"].startswith("No alert: your area in October 2026")


def test_run_writes_eml_never_sends(tmp_path, capsys):
    c = _client(tmp_path, date(2026, 11, 2))
    subs = [{"id": "a1", "email": "farmer@example.com", "aoi": BOX, "name": "Delta", "threshold": "above_normal"},
            {"id": "a2", "email": "quiet@example.com", "aoi": {"type": "bbox", "bbox": [10, 10, 10.5, 10.5]},
             "name": "Nowhere", "threshold": "above_normal"}]
    out = alerts.run(c, subs, tmp_path / "outbox", now=datetime(2026, 11, 13, 9, tzinfo=timezone.utc))
    assert [p.name for p in out] == ["20261113T090000Z_a1_2026-10.eml"]
    msg = email.message_from_bytes(out[0].read_bytes())
    assert msg["To"] == "farmer@example.com" and msg["X-Almatafi-Demo"] == "not sent"
    assert msg["Subject"].startswith("Fire alert: Delta") and msg.is_multipart()
    assert "a2:" in capsys.readouterr().out


def test_cli_add_and_list(tmp_path, capsys):
    assert alerts.main(["--data", str(tmp_path), "add", "--email", "x@example.com", "--region", "nile-delta"]) == 0
    assert alerts.main(["--data", str(tmp_path), "list"]) == 0
    assert "x@example.com  nile-delta  ≥ above_normal" in capsys.readouterr().out
    with pytest.raises(SystemExit):
        alerts.main(["--data", str(tmp_path), "add", "--email", "x@example.com"])
