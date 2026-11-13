"""Polygon simplification shared by /search and /admin."""

from __future__ import annotations

import shapely
from shapely.geometry import mapping, shape

MAX_VERTICES = 2000
MAX_SIMPLIFY_ROUNDS = 20


def _vertices(geom) -> int:
    return int(shapely.get_num_coordinates(geom))


def simplify_polygon(geometry: dict | None) -> dict | None:
    """Polygons only (the UI offers a radius for points), at most 2 000 vertices."""
    if not geometry or geometry.get("type") not in ("Polygon", "MultiPolygon"):
        return None
    geom = shape(geometry)
    if not geom.is_valid:
        geom = shapely.make_valid(geom)
        if geom.geom_type == "GeometryCollection":
            # A ring that runs out and back along a line ("spike") repairs into polygons plus a
            # stray line; keep the polygons instead of dropping the whole shape.
            polys = [g for g in geom.geoms if g.geom_type in ("Polygon", "MultiPolygon")]
            geom = shapely.union_all(polys) if polys else geom
    tolerance = 0.0005
    for _ in range(MAX_SIMPLIFY_ROUNDS):
        if _vertices(geom) <= MAX_VERTICES:
            break
        geom = geom.simplify(tolerance, preserve_topology=True)
        tolerance *= 2
    if _vertices(geom) > MAX_VERTICES:
        # Many small parts can't simplify below the cap (each keeps ≥ 4 points): keep the largest
        # parts without holes, and fall back to the bounding box if even that is too much.
        parts = sorted((shapely.Polygon(p.exterior) for p in getattr(geom, "geoms", [geom])
                        if p.geom_type == "Polygon"), key=lambda p: p.area, reverse=True)
        kept, n = [], 0
        for p in parts:
            if n + _vertices(p) > MAX_VERTICES:
                break
            kept.append(p)
            n += _vertices(p)
        geom = shapely.MultiPolygon(kept) if len(kept) > 1 else (kept[0] if kept else shapely.box(*geom.bounds))
    if geom.geom_type not in ("Polygon", "MultiPolygon"):
        return None
    return mapping(geom)
