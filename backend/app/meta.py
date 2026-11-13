from __future__ import annotations

from datetime import datetime, timezone


def now_utc() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def build_meta(data_version: str, aoi=None) -> dict:
    """The `meta` block every JSON response carries (api.md §1.4)."""
    meta = {"data_version": data_version, "generated_at": now_utc()}
    if aoi is not None:
        meta["aoi"] = aoi.meta()
    return meta
