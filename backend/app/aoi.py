"""Area of interest: request shapes, validation, area and grid cells.

Implements api.md §1.1 and grid.md §5. Every AOI form becomes one shapely (Multi)Polygon
in lon/lat, split at the antimeridian, with its geodesic area and the 0.1° cells inside.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Annotated, Literal, Union

import numpy as np
import shapely
from shapely import affinity
from pydantic import BaseModel, Field
from pyproj import Geod
from shapely.geometry import MultiPolygon, Polygon, box
from shapely.validation import explain_validity

from almatafi import cells

from app.errors import ApiError

GEOD = Geod(ellps="WGS84")
MAX_VERTICES = 2000
MAX_RADIUS_KM = 500
CIRCLE_POINTS = 128
COARSE_MIN_CELLS = 4  # fewer cell centres than this → use touching cells and warn
# Candidate cells scanned per AOI (sum of all parts' bounding boxes). A 5M km² AOI needs at
# most ~250k cells even near the poles; this stops thin or many-part shapes from scanning millions.
MAX_WINDOW_CELLS = 1_500_000
WORLD = box(-180, -90, 180, 90)

# Area limits per use (api.md §1.1).
LIMIT_GRID_KM2 = 5_000_000
LIMIT_POINTS_KM2 = 500_000


class PolygonAoi(BaseModel):
    type: Literal["polygon"]
    geometry: dict


class BboxAoi(BaseModel):
    type: Literal["bbox"]
    bbox: list[float] = Field(min_length=4, max_length=4)


class PointAoi(BaseModel):
    type: Literal["point"]
    lat: float
    lon: float
    radius_km: float


class AdminAoi(BaseModel):
    type: Literal["admin"]
    admin_id: str


class RegionAoi(BaseModel):
    type: Literal["region"]
    region_id: str


Aoi = Annotated[Union[PolygonAoi, BboxAoi, PointAoi, AdminAoi, RegionAoi], Field(discriminator="type")]


@dataclass
class ResolvedAoi:
    geometry: Polygon | MultiPolygon   # within ±180 / ±90, split at the antimeridian
    area_km2: float
    bbox: list[float]                  # [west, south, east, north]; west > east when it crosses 180°
    cell_ids: np.ndarray               # int32, sorted
    coarse_warning: bool

    def meta(self) -> dict:
        return {"area_km2": round(self.area_km2, 1), "cells": int(self.cell_ids.size),
                "bbox": [round(v, 4) for v in self.bbox], "coarse_warning": self.coarse_warning}

    def check_area(self, limit_km2: float, what: str) -> None:
        if self.area_km2 > limit_km2:
            raise ApiError(422, "too_large",
                           f"Area is {self.area_km2:,.0f} km²; the limit for {what} is {limit_km2:,.0f} km².",
                           {"area_km2": round(self.area_km2, 1), "limit_km2": limit_km2})


def _invalid(message: str, **details) -> ApiError:
    return ApiError(422, "invalid_aoi", message, details)


class AdminStore:
    """Admin boundaries from data/admin/*.geojson, written by /api/admin (app/admin.py)."""

    def __init__(self, folder: Path):
        self.folder = folder
        self._shapes: dict[str, dict] | None = None

    @staticmethod
    def _put(shapes: dict, features: list[dict]) -> None:
        for f in features:
            admin_id = (f.get("properties") or {}).get("admin_id")
            if admin_id and f.get("geometry"):
                shapes[admin_id] = f["geometry"]

    def _load(self) -> dict[str, dict]:
        if self._shapes is None:
            shapes: dict[str, dict] = {}
            for path in sorted(self.folder.glob("*.geojson")) if self.folder.exists() else []:
                self._put(shapes, json.loads(path.read_text())["features"])
            self._shapes = shapes
        return self._shapes

    def add(self, features: list[dict]) -> None:
        """Make newly fetched boundaries usable as AOIs right away."""
        self._put(self._load(), features)

    def get(self, admin_id: str) -> dict | None:
        return self._load().get(admin_id)


def _unwrap_ring(coords) -> list[tuple[float, float]]:
    """Make longitudes continuous along the ring, so a shape drawn across 180° stays one piece.

    An edge longer than 180° of longitude is read as crossing 180° (the shorter way round).
    A shape wider than 180° must have vertices less than 180° apart (the explorer adds them).
    """
    out, shift, prev = [], 0.0, None
    for x, y, *_ in coords:
        x, y = float(x), float(y)
        # Rejects NaN and ±Infinity too (Python's JSON parser accepts them).
        if not (-540 <= x <= 540 and -90 <= y <= 90):
            raise _invalid("coordinates must be finite, longitude within ±540, latitude within ±90")
        if prev is not None:
            shift -= 360 * round((x + shift - prev) / 360)
        prev = x + shift
        out.append((prev, y))
    return out


def _align(hole: list[tuple[float, float]], shell: list[tuple[float, float]]) -> list[tuple[float, float]]:
    """Shift a hole by whole turns so it sits on its shell: each ring is unwrapped on its own,
    so a hole starting at -179 inside a shell starting at 175 would land 360° away."""
    mid = lambda r: (min(x for x, _ in r) + max(x for x, _ in r)) / 2  # noqa: E731
    dx = 360 * round((mid(shell) - mid(hole)) / 360)
    return [(x + dx, y) for x, y in hole] if dx else hole


def _wrap(geom) -> Polygon | MultiPolygon:
    """Fold a lon/lat shape that runs past ±180 back into the world, split at the antimeridian."""
    parts = [shapely.intersection(affinity.translate(geom, xoff=dx), WORLD) for dx in (-360, 0, 360)]
    merged = shapely.union_all([p for p in parts if not p.is_empty])
    polys = [g for g in getattr(merged, "geoms", [merged]) if isinstance(g, Polygon) and not g.is_empty]
    return polys[0] if len(polys) == 1 else MultiPolygon(polys)


def _rfc7946_bbox(geom) -> list[float]:
    """Smallest [west, south, east, north] around the parts of a shape already within ±180.

    It crosses 180° (west > east) when the widest gap between the parts' longitudes isn't the
    one at 180°. So a shape given as separate parts on each side (Fiji, the Aleutians) gets a
    small crossing box, not one spanning the whole world.
    """
    _, s, _, n = geom.bounds
    spans = sorted((p.bounds[0], p.bounds[2]) for p in getattr(geom, "geoms", [geom]))
    merged = [list(spans[0])]
    for w, e in spans[1:]:
        if w <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], e)
        else:
            merged.append([w, e])
    gap, west, east = merged[0][0] + 360 - merged[-1][1], merged[0][0], merged[-1][1]  # the gap at 180°
    for (_, e0), (w1, _) in zip(merged, merged[1:]):
        if w1 - e0 > gap:
            gap, west, east = w1 - e0, w1, e0
    return [float(west), s, float(east), n]


def _from_geojson(geometry: dict):
    if not isinstance(geometry, dict) or geometry.get("type") not in ("Polygon", "MultiPolygon"):
        raise _invalid("geometry must be a GeoJSON Polygon or MultiPolygon")
    try:
        polys = geometry["coordinates"] if geometry["type"] == "MultiPolygon" else [geometry["coordinates"]]
        vertices = sum(len(ring) for poly in polys for ring in poly)
        if vertices > MAX_VERTICES:
            raise _invalid(f"Polygon has {vertices} vertices; the limit is {MAX_VERTICES}.", vertices=vertices)
        fixed = []
        for poly in polys:
            rings = [_unwrap_ring(r) for r in poly]
            if any(len(r) < 3 for r in rings):
                raise _invalid("every ring needs at least 3 points")
            fixed.append(Polygon(rings[0], [_align(h, rings[0]) for h in rings[1:]]))
        geom = fixed[0] if len(fixed) == 1 else MultiPolygon(fixed)
    except ApiError:
        raise
    except (KeyError, TypeError, ValueError, IndexError) as e:
        raise _invalid(f"geometry could not be read: {e}") from None
    if not geom.is_valid:
        raise _invalid(f"Polygon is not valid: {explain_validity(geom)}")
    return geom


def _circle(lat: float, lon: float, radius_km: float):
    if not 1 <= radius_km <= MAX_RADIUS_KM:
        raise _invalid(f"radius_km must be between 1 and {MAX_RADIUS_KM}", radius_km=radius_km)
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        raise _invalid("point out of range", lat=lat, lon=lon)
    az = np.linspace(0, 360, CIRCLE_POINTS, endpoint=False)
    xs, ys, _ = GEOD.fwd(np.full(az.size, lon), np.full(az.size, lat), az, np.full(az.size, radius_km * 1000))
    ring = _unwrap_ring(list(zip(xs, ys)) + [(xs[0], ys[0])])
    # A circle around a pole ends a full turn (±360°) from where it started once unwrapped:
    # close it along the pole, so it keeps its true size instead of becoming a whole polar cap.
    if abs(ring[-1][0] - ring[0][0]) > 180:
        pole = 90.0 if lat > 0 else -90.0
        ring += [(ring[-1][0], pole), (ring[0][0], pole)]
    return Polygon(ring)


def _bbox(b: list[float]):
    w, s, e, n = b
    if not (-90 <= s < n <= 90 and -180 <= w <= 180 and -180 <= e <= 180) or w == e:
        raise _invalid("bbox must be [west, south, east, north] with south < north", bbox=b)
    return box(w, s, e + 360 if e < w else e, n)  # west > east means it crosses 180°


def geodesic_area_km2(geom) -> float:
    # Edges are straight lines in lon/lat (as drawn on the map and as cells are picked),
    # so split them into 0.1° steps before measuring instead of treating them as geodesics.
    # Measured in 90° slices: an edge spanning 360° would collapse to a point.
    total = 0.0
    for w in (-180, -90, 0, 90):
        part = shapely.segmentize(shapely.intersection(geom, box(w, -90, w + 90, 90)), 0.1)
        for g in getattr(part, "geoms", [part]):
            if isinstance(g, Polygon) and not g.is_empty:
                total += abs(GEOD.geometry_area_perimeter(g)[0])
    return total / 1e6


def _grid_window(poly: Polygon):
    w, s, e, n = poly.bounds
    r0, r1 = cells.cell_row(max(s, -90)), cells.cell_row(min(n, 90))
    c0, c1 = cells.cell_col(max(w, -180)), cells.cell_col(min(e, 180))
    rows, cols = np.meshgrid(np.arange(r0, r1 + 1), np.arange(c0, c1 + 1), indexing="ij")
    rows, cols = rows.ravel(), cols.ravel()
    lat = (2 * rows + 1 - 1800) / 20
    lon = (2 * cols + 1 - 3600) / 20
    return (rows * cells.N_COLS + cols).astype(np.int32), lon, lat


def _window_size(poly: Polygon) -> int:
    w, s, e, n = poly.bounds
    rows = cells.cell_row(min(n, 90)) - cells.cell_row(max(s, -90)) + 1
    cols = cells.cell_col(min(e, 180)) - cells.cell_col(max(w, -180)) + 1
    return rows * cols


def cells_in(geom) -> tuple[np.ndarray, bool]:
    """Cells whose centre is inside; if fewer than 4, the cells it touches (grid.md §5)."""
    parts = list(getattr(geom, "geoms", [geom]))
    scanned = sum(_window_size(p) for p in parts)
    if scanned > MAX_WINDOW_CELLS:
        raise _invalid("Shape spans too wide an extent; draw a smaller or more compact area.",
                       cells_scanned=scanned)
    shapely.prepare(geom)
    windows = [_grid_window(p) for p in parts]
    inside = [ids[shapely.contains_xy(geom, lon, lat)] for ids, lon, lat in windows]
    ids = np.unique(np.concatenate(inside))
    if ids.size >= COARSE_MIN_CELLS:
        return ids, False
    touched = []
    for ids_w, lon, lat in windows:
        boxes = shapely.box(lon - 0.05, lat - 0.05, lon + 0.05, lat + 0.05)
        hit = shapely.intersects(geom, boxes) & ~shapely.touches(geom, boxes)
        touched.append(ids_w[hit])
    return np.unique(np.concatenate(touched)), True


def cells_touching(geom, max_window: int) -> np.ndarray:
    """Every cell the shape overlaps, centre inside or not. Points inside the shape can only
    lie in these cells, so it's a tight prefilter for point queries."""
    parts = list(getattr(geom, "geoms", [geom]))
    scanned = sum(_window_size(p) for p in parts)
    if scanned > max_window:
        raise _invalid("Shape spans too wide an extent for point queries; draw a smaller or more compact area.",
                       cells_scanned=scanned, limit=max_window)
    shapely.prepare(geom)
    hits = []
    for ids, lon, lat in (_grid_window(p) for p in parts):
        hits.append(ids[shapely.intersects(geom, shapely.box(lon - 0.05, lat - 0.05, lon + 0.05, lat + 0.05))])
    return np.unique(np.concatenate(hits))


def resolve(aoi, regions: dict, admin: AdminStore, max_area_km2: float | None = None,
            what: str = "this request") -> ResolvedAoi:
    """Pass max_area_km2 so the size limit is checked before any cells are scanned."""
    if isinstance(aoi, PolygonAoi):
        raw = _from_geojson(aoi.geometry)
    elif isinstance(aoi, BboxAoi):
        raw = _bbox(aoi.bbox)
    elif isinstance(aoi, PointAoi):
        raw = _circle(aoi.lat, aoi.lon, aoi.radius_km)
    elif isinstance(aoi, RegionAoi):
        if aoi.region_id not in regions:
            raise ApiError(404, "not_found", f"Unknown region_id '{aoi.region_id}'.", {"region_id": aoi.region_id})
        raw = _from_geojson(regions[aoi.region_id]["geometry"])
    elif isinstance(aoi, AdminAoi):
        geometry = admin.get(aoi.admin_id)
        if geometry is None:
            raise ApiError(404, "not_found", f"Unknown admin_id '{aoi.admin_id}'.", {"admin_id": aoi.admin_id})
        raw = _from_geojson(geometry)
    else:  # pragma: no cover - pydantic only lets the five forms through
        raise _invalid("unknown aoi type")

    geom = _wrap(raw)
    area = geodesic_area_km2(geom)
    if geom.is_empty or area <= 0:
        raise _invalid("Area is empty.")
    resolved = ResolvedAoi(geom, area, _rfc7946_bbox(geom), np.empty(0, np.int32), False)
    if max_area_km2 is not None:
        resolved.check_area(max_area_km2, what)
    resolved.cell_ids, resolved.coarse_warning = cells_in(geom)
    return resolved

