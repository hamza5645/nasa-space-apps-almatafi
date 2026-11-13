"""Demo-region cache (data-products.md §5, PLAN.md §14.4).

Saves the full responses of the real endpoints for each demo region, so the frontend can
fall back to static files when the backend is asleep or down:

    data/cache/index.json            regions, data_version, when the cache was made
    data/cache/{region_id}.json      region, 6 calendars (view × metric), /stats for every
                                     month, /hotspots for the region's default month
    data/cache/validation.json       /api/validation, for the method page

Run after the pipeline:  python -m app.cache [--out data/cache] [--today YYYY-MM-DD]
The frontend copies data/cache/ to its public folder (static fallback).
"""

from __future__ import annotations

import argparse
import calendar
import json
from datetime import date, datetime, timezone
from pathlib import Path

from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app

VIEWS = ("harmonized", "modis", "viirs")
METRICS = ("detections", "fire_days")


def build_cache(settings: Settings, out: Path) -> dict:
    client = TestClient(create_app(settings))
    regions = client.get("/api/regions").json()["regions"]
    data_version = client.get("/api/health").json()["data_version"]
    out.mkdir(parents=True, exist_ok=True)
    index = {"data_version": data_version,
             "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "regions": []}

    for region in regions:
        aoi = {"type": "region", "region_id": region["region_id"]}
        calendars = {}
        for view in VIEWS:
            calendars[view] = {}
            for metric in METRICS:
                r = client.post("/api/calendar", json={"aoi": aoi, "view": view, "metric": metric})
                if r.status_code == 200:
                    calendars[view][metric] = r.json()

        stats = {}
        harmonized = calendars["harmonized"].get("detections")
        if harmonized:
            for y, row in zip(harmonized["years"], harmonized["matrix"]):
                for m, v in zip(harmonized["months"], row):
                    if v is None:
                        continue
                    month = f"{y}-{m:02d}"
                    r = client.post("/api/stats", json={"aoi": aoi, "month": month})
                    if r.status_code == 200:
                        stats[month] = r.json()

        y, m = (int(x) for x in region["default_month"].split("-"))
        last = calendar.monthrange(y, m)[1]
        r = client.post("/api/hotspots", json={"aoi": aoi, "start": f"{y}-{m:02d}-01",
                                               "end": f"{y}-{m:02d}-{last:02d}"})
        hotspots = r.json() if r.status_code == 200 else None

        doc = {"region": region, "data_version": data_version, "generated_at": index["generated_at"],
               "calendar": calendars, "stats": stats, "hotspots": {region["default_month"]: hotspots}}
        path = out / f"{region['region_id']}.json"
        path.write_text(json.dumps(doc, separators=(",", ":")))
        index["regions"].append({"region_id": region["region_id"], "file": path.name,
                                 "stats_months": len(stats), "bytes": path.stat().st_size})

    r = client.get("/api/validation")
    if r.status_code == 200:
        (out / "validation.json").write_text(json.dumps(r.json(), separators=(",", ":")))
        index["validation"] = "validation.json"
    (out / "index.json").write_text(json.dumps(index, indent=2) + "\n")
    return index


def main(argv=None) -> None:
    ap = argparse.ArgumentParser(description="Save demo-region responses as static JSON.")
    ap.add_argument("--data", type=Path, default=None, help="data folder (default: ALMATAFI_DATA_DIR)")
    ap.add_argument("--out", type=Path, default=None, help="default: <data>/cache")
    ap.add_argument("--today", type=date.fromisoformat, default=None, help="pin 'today' (YYYY-MM-DD)")
    args = ap.parse_args(argv)
    base = Settings()
    settings = Settings(data_dir=args.data or base.data_dir, today=args.today)
    index = build_cache(settings, args.out or settings.data_dir / "cache")
    for r in index["regions"]:
        print(f"{r['region_id']}: {r['stats_months']} months of stats, {r['bytes'] / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
