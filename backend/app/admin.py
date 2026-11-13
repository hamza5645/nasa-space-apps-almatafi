"""GET /api/admin: administrative boundaries from geoBoundaries (api.md §2.9).

The geoBoundaries API names a download URL; downloads are only allowed over https from
geoBoundaries' own and GitHub hosts (checked on every redirect too) and are size-capped.
Each country/level is fetched once and kept in data/admin/{ISO}_ADM{n}.geojson, which the
AOI parser reads, so `{"type": "admin", "admin_id": …}` works for every fetched boundary.

Prefetch before a demo:  python -m app.admin EGY:1 ARG:1 CHL:1
"""

from __future__ import annotations

import json
import os
import sys
import threading
from pathlib import Path

import httpx
from fastapi import APIRouter, Query, Request

from app.errors import ApiError
from app.geometry import simplify_polygon
from app.meta import build_meta

router = APIRouter(prefix="/api")

ALLOWED_HOSTS = {"www.geoboundaries.org", "geoboundaries.org", "github.com", "raw.githubusercontent.com",
                 "media.githubusercontent.com"}
MAX_BYTES = 60 * 1024 * 1024
LEVELS = (0, 1, 2)


class UpstreamNotFound(Exception):
    pass


def _check_host(request: httpx.Request) -> None:
    if request.url.scheme != "https" or request.url.host not in ALLOWED_HOSTS:
        raise httpx.UnsupportedProtocol(f"blocked download host: {request.url.host}")


class GeoBoundaries:
    def __init__(self, api_base: str, folder: Path, transport: httpx.BaseTransport | None = None):
        self.api_base = api_base.rstrip("/")
        self.folder = folder
        self.client = httpx.Client(transport=transport, timeout=30.0, follow_redirects=True,
                                   headers={"User-Agent": "almatafi/0.1 (NASA Space Apps Cairo)"},
                                   event_hooks={"request": [_check_host]})
        self._locks: dict[str, threading.Lock] = {}
        self._guard = threading.Lock()

    def path(self, country: str, level: int) -> Path:
        return self.folder / f"{country}_ADM{level}.geojson"

    def get(self, country: str, level: int) -> dict:
        """The FeatureCollection for one country and level, from disk or fetched once."""
        path = self.path(country, level)
        with self._guard:
            lock = self._locks.setdefault(path.name, threading.Lock())
        with lock:  # one download per country/level, even with parallel requests
            if path.exists():
                return json.loads(path.read_text())
            doc = self._fetch(country, level)
            path.parent.mkdir(parents=True, exist_ok=True)
            tmp = path.with_suffix(".tmp")
            tmp.write_text(json.dumps(doc))
            os.replace(tmp, path)
            return doc

    def _read(self, url: str) -> bytes:
        with self.client.stream("GET", url) as r:
            if r.status_code == 404:
                raise UpstreamNotFound(url)
            r.raise_for_status()
            chunks, size = [], 0
            for chunk in r.iter_bytes():
                size += len(chunk)
                if size > MAX_BYTES:
                    raise ValueError("boundary file too large")
                chunks.append(chunk)
        return b"".join(chunks)

    def _fetch(self, country: str, level: int) -> dict:
        meta = json.loads(self._read(f"{self.api_base}/{country}/ADM{level}/"))
        if isinstance(meta, list):
            meta = meta[0] if meta else {}
        url = meta.get("simplifiedGeometryGeoJSON") or meta.get("gjDownloadURL")
        if not url:
            raise UpstreamNotFound(country)
        raw = json.loads(self._read(url))
        features = []
        for f in raw.get("features", []):
            props = f.get("properties") or {}
            geometry = simplify_polygon(f.get("geometry"))
            if geometry is None or not props.get("shapeID"):
                continue
            features.append({"type": "Feature", "geometry": geometry,
                             "properties": {"admin_id": props["shapeID"], "name": props.get("shapeName"),
                                            "level": level, "country": country}})
        if not features:
            raise UpstreamNotFound(country)
        return {"type": "FeatureCollection", "features": features}


@router.get("/admin")
def admin(request: Request, country: str = Query(pattern=r"^[A-Za-z]{3}$"), level: int = Query(default=1)):
    if level not in LEVELS:
        raise ApiError(400, "bad_request", "level must be 0, 1 or 2.")
    country = country.upper()
    try:
        doc = request.app.state.boundaries.get(country, level)
    except UpstreamNotFound:
        raise ApiError(404, "not_found", f"No ADM{level} boundaries for {country}.",
                       {"country": country, "level": level}) from None
    except (httpx.HTTPError, ValueError, KeyError, TypeError):
        raise ApiError(502, "upstream_error", "Boundaries are unavailable right now; try again shortly.",
                       {"upstream": "geoboundaries"}) from None
    request.app.state.admin.add(doc["features"])
    return doc | {"meta": build_meta(request.app.state.data.data_version())}


def main(argv: list[str]) -> None:
    from app.config import Settings

    settings = Settings()
    gb = GeoBoundaries(settings.geoboundaries_url, settings.data_dir / "admin")
    for item in argv:
        country, level = item.upper().split(":")
        doc = gb.get(country, int(level))
        print(f"{country} ADM{level}: {len(doc['features'])} areas → {gb.path(country, int(level))}")


if __name__ == "__main__":
    main(sys.argv[1:])
