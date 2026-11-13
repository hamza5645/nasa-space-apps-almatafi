"""GET /api/search: place search through Nominatim (api.md §2.8).

Follows the Nominatim usage policy: an identifying User-Agent, at most 1 request per second
(all requests share one lock), and results cached for 24 hours.
"""

from __future__ import annotations

import threading
import time
from collections import OrderedDict
from typing import Callable

import httpx
import shapely.errors
from fastapi import APIRouter, Query, Request

from app.errors import ApiError
from app.geometry import simplify_polygon
from app.meta import build_meta

router = APIRouter(prefix="/api")

CACHE_TTL_S = 24 * 3600
CACHE_MAX = 2000
MIN_INTERVAL_S = 1.0
MAX_QUEUE_S = 5.0        # refuse instead of queueing when the next free slot is further away than this


class Nominatim:
    def __init__(self, url: str, user_agent: str, transport: httpx.BaseTransport | None = None,
                 clock: Callable[[], float] = time.monotonic, sleep: Callable[[float], None] = time.sleep):
        self.url = url
        self.client = httpx.Client(transport=transport, timeout=10.0, headers={"User-Agent": user_agent})
        self.clock, self.sleep = clock, sleep
        self.lock = threading.Lock()
        self.last_request = -MIN_INTERVAL_S
        self.cache: OrderedDict[tuple, tuple[float, list]] = OrderedDict()

    def search(self, q: str, limit: int) -> list[dict]:
        key = (" ".join(q.lower().split()), limit)
        # The lock only guards the cache and books a time slot; the request runs outside it.
        with self.lock:
            now = self.clock()
            hit = self.cache.get(key)
            if hit and hit[0] > now:
                self.cache.move_to_end(key)
                return hit[1]
            slot = max(now, self.last_request + MIN_INTERVAL_S)
            if slot - now > MAX_QUEUE_S:
                raise ApiError(502, "upstream_error", "Place search is busy; try again in a few seconds.",
                               {"upstream": "nominatim", "retry_after_s": round(slot - now)})
            self.last_request = slot
        if slot > now:
            self.sleep(slot - now)
        try:
            # English names: without accept-language, Nominatim answers in the local script
            # ("كفر الشيخ" for Kafr El Sheikh, "Viti" for Fiji).
            r = self.client.get(self.url, params={"q": q, "format": "jsonv2", "limit": limit,
                                                  "polygon_geojson": 1, "polygon_threshold": 0.001,
                                                  "accept-language": "en"})
            r.raise_for_status()
            raw = r.json()
            if not isinstance(raw, list):
                raise ValueError("unexpected response")
            results = [_crossing_bbox(_place(item)) for item in raw]
        except (httpx.HTTPError, ValueError, KeyError, TypeError, shapely.errors.ShapelyError):
            raise ApiError(502, "upstream_error", "Place search is unavailable right now; try again shortly.",
                           {"upstream": "nominatim"}) from None
        with self.lock:
            self.cache[key] = (self.clock() + CACHE_TTL_S, results)
            if len(self.cache) > CACHE_MAX:
                self.cache.popitem(last=False)
        return results


def _place(item: dict) -> dict:
    south, north, west, east = (float(v) for v in item["boundingbox"])  # Nominatim order
    display = item["display_name"]
    return {
        "name": item.get("name") or display.split(",")[0],
        "display_name": display,
        "kind": item.get("addresstype") or item.get("type"),
        "centroid": [float(item["lon"]), float(item["lat"])],
        "bbox": [west, south, east, north],
        "geometry": simplify_polygon(item.get("geojson")),
    }


def _crossing_bbox(place: dict) -> dict:
    """Nominatim gives a place in parts on both sides of 180° (Fiji, Chukotka) a world-wide
    bbox, [-180, s, 180, n]. Take the smallest box around the parts instead, which crosses
    180° (west > east), as RFC 7946 and the AOI contract allow."""
    from shapely.geometry import shape

    from app.aoi import _rfc7946_bbox

    if place["geometry"] and place["bbox"][0] <= -179.9 and place["bbox"][2] >= 179.9:
        place["bbox"] = _rfc7946_bbox(shape(place["geometry"]))
    return place


@router.get("/search")
def search(request: Request, q: str = Query(min_length=1, max_length=200),
           limit: int = Query(default=5, ge=1, le=10)):
    if not q.strip():
        raise ApiError(400, "bad_request", "q is empty.")
    results = request.app.state.search.search(q.strip(), limit)
    return {"results": results, "meta": build_meta(request.app.state.data.data_version())}
