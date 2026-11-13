"""Demo regions (api.md §2.2). Geometries are the bboxes until the final shapes are drawn."""

from __future__ import annotations


def _box(w, s, e, n):
    return {"type": "Polygon", "coordinates": [[[w, s], [e, s], [e, n], [w, n], [w, s]]]}


REGIONS = {
    "nile-delta": {
        "region_id": "nile-delta", "name": "Nile Delta", "country": "Egypt",
        "bbox": [29.9, 30.0, 32.3, 31.6], "geometry": _box(29.9, 30.0, 32.3, 31.6),
        "default_month": "2026-10",
        "story": "Rice-straw burning season, October to November.",
    },
    "rio-negro": {
        "region_id": "rio-negro", "name": "Río Negro", "country": "Argentina",
        "bbox": [-71.8, -41.8, -68.0, -39.5], "geometry": _box(-71.8, -41.8, -68.0, -39.5),
        "default_month": "2026-07",
        "story": "July 2026 fire event in Río Negro and Chile.",
    },
}
