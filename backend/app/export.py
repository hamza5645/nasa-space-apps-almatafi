"""POST /api/export (api.md §2.7) and GET /api/validation (§2.10)."""

from __future__ import annotations

import csv
import io
import json
import math
from datetime import date
from xml.sax.saxutils import escape
from typing import Literal

import numpy as np
import rasterio
import rasterio.shutil
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field
from rasterio.io import MemoryFile
from rasterio.transform import from_origin

from almatafi import cells

from app.aoi import LIMIT_GRID_KM2, Aoi
from app.errors import ApiError
from app.meta import build_meta
from app.routes import Metric, View, _check_months, _resolve, _today, calendar_payload, feature, hotspot_frame
from app.series import UNITS, Reader, parse_ym

router = APIRouter(prefix="/api")

MAX_BANDS = 120
MAX_CSV_ROWS = 5_000_000
# Measured peak memory is ~20 bytes per pixel plus ~60 MB (the float32 array, the uncompressed
# staging file and the COG copy with overviews): 30M pixels took +640 MB, too close to the API's
# 1 GB cap. 10M takes ~+250 MB and still fits a compact 5M km² AOI near the equator with 120
# monthly bands; a multi-part AOI spread across continents does not.
MAX_TIFF_PIXELS = 10_000_000
# Point exports are built in memory; a year of a 500k km² area in a busy fire region stays under this.
MAX_EXPORT_POINTS = 200_000
NODATA = -1.0
FORMATS = {"hotspots": ("csv", "geojson", "kml"), "calendar": ("csv", "json"), "grid": ("geotiff", "csv")}
CONTENT_TYPES = {"csv": "text/csv; charset=utf-8", "geojson": "application/geo+json",
                 "json": "application/json", "geotiff": "image/tiff; application=geotiff; profile=cloud-optimized",
                 "kml": "application/vnd.google-earth.kml+xml"}
EXTENSIONS = {"csv": "csv", "geojson": "geojson", "json": "json", "geotiff": "tif", "kml": "kml"}
POINT_CSV = ["point_id", "lat", "lon", "sensor", "platform", "acq_datetime_utc", "daynight", "frp",
             "confidence_class", "confidence_pct", "fire_type", "brightness_k", "scan_km", "track_km",
             "cell_id", "source"]


class ExportRequest(BaseModel):
    aoi: Aoi
    what: Literal["hotspots", "calendar", "grid"]
    format: Literal["csv", "geojson", "json", "geotiff", "kml"]
    start: str = Field(pattern=r"^\d{4}-\d{2}(-\d{2})?$")
    end: str = Field(pattern=r"^\d{4}-\d{2}(-\d{2})?$")
    view: View = "harmonized"
    metric: Metric = "detections"
    aggregate: Literal["sum", "monthly"] = "sum"
    sensors: list[Literal["MODIS", "VIIRS"]] = Field(default=["MODIS", "VIIRS"], min_length=1)
    include_filtered: bool = False


def _file(content: bytes, fmt: str, what: str, start: str, end: str) -> Response:
    name = f"almatafi_{what}_{start}_{end}.{EXTENSIONS[fmt]}"
    return Response(content, media_type=CONTENT_TYPES[fmt],
                    headers={"Content-Disposition": f'attachment; filename="{name}"'})


def _csv(header: list[str], rows) -> bytes:
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\n")
    w.writerow(header)
    w.writerows(rows)
    return buf.getvalue().encode()


def _months_arg(s: str, field: str) -> str:
    if len(s) != 7:
        raise ApiError(400, "bad_request", f"{field} must be a month (YYYY-MM) for this export.")
    if not 1 <= int(s[5:7]) <= 12:
        raise ApiError(400, "bad_request", f"{field} is not a valid month.")
    return s


def _date_arg(s: str, field: str) -> date:
    try:
        if len(s) != 10:
            raise ValueError
        return date.fromisoformat(s)
    except ValueError:
        raise ApiError(400, "bad_request", f"{field} must be a date (YYYY-MM-DD) for hotspot exports.") from None


@router.post("/export")
def export(body: ExportRequest, request: Request):
    if body.format not in FORMATS[body.what]:
        raise ApiError(400, "bad_request", f"{body.what} exports come as {' or '.join(FORMATS[body.what])}.")
    if body.what == "hotspots":
        return _hotspots(body, request)
    start, end = _months_arg(body.start, "start"), _months_arg(body.end, "end")
    if body.what == "calendar":
        return _calendar(body, request, start, end)
    return _grid(body, request, start, end)


def _hotspots(body: ExportRequest, request: Request) -> Response:
    start, end = _date_arg(body.start, "start"), _date_arg(body.end, "end")
    df, aoi, _ = hotspot_frame(request, body.aoi, start, end, body.sensors, body.include_filtered)
    if len(df) > MAX_EXPORT_POINTS:
        raise ApiError(422, "too_large", f"{len(df):,} points; exports are limited to {MAX_EXPORT_POINTS:,}. "
                       "Narrow the dates or the area.", {"points": len(df), "limit_points": MAX_EXPORT_POINTS})
    features = [feature(r) for r in df.itertuples(index=False)]
    if body.format == "geojson":
        doc = {"type": "FeatureCollection", "features": features, "total": len(features),
               "meta": build_meta(request.app.state.data.data_version(), aoi)}
        content = json.dumps(doc).encode()
    elif body.format == "kml":
        content = hotspots_kml(features, f"Almatafi hotspots {body.start} to {body.end}")
    else:
        rows = []
        for f in features:
            p = f["properties"] | {"lon": f["geometry"]["coordinates"][0], "lat": f["geometry"]["coordinates"][1]}
            rows.append(["" if p[c] is None else p[c] for c in POINT_CSV])
        content = _csv(POINT_CSV, rows)
    return _file(content, body.format, "hotspots", body.start, body.end)


# KML colours are aabbggrr. Fire radiative power classes, low to high (the map's ember ramp).
FRP_STYLES = [(5, "frp-low", "ff4fb7ff"), (20, "frp-mid", "ff2a8cff"), (100, "frp-high", "ff1a4ef0"),
              (math.inf, "frp-extreme", "ff3b1fb4")]
KML_FIELDS = [("platform", "Satellite"), ("sensor", "Sensor"), ("acq_datetime_utc", "Time (UTC)"),
              ("daynight", "Day/night"), ("frp", "FRP (MW)"), ("confidence_class", "Confidence"),
              ("confidence_pct", "Confidence (%)"), ("brightness_k", "Brightness (K)"),
              ("scan_km", "Pixel along scan (km)"), ("track_km", "Pixel along track (km)"), ("source", "Source")]


def footprint(lon: float, lat: float, scan_km, track_km) -> list[tuple[float, float]] | None:
    """The pixel's ground footprint as a closed ring: scan × track km around the centre,
    scan taken east-west and track north-south (polar orbits; an approximation, as in FIRMS's
    footprint KMZ files). None without a pixel size."""
    if not scan_km or not track_km:
        return None
    dlon = scan_km / 2 / (111.32 * max(math.cos(math.radians(lat)), 0.01))
    dlat = track_km / 2 / 110.57
    return [(lon - dlon, lat - dlat), (lon + dlon, lat - dlat), (lon + dlon, lat + dlat),
            (lon - dlon, lat + dlat), (lon - dlon, lat - dlat)]


def hotspots_kml(features: list[dict], title: str) -> bytes:
    """Hotspots as KML for Google Earth and GIS tools: one placemark per hotspot with its pixel
    footprint, coloured by fire radiative power, in one folder per satellite."""
    def style_of(frp):
        return next(sid for top, sid, _ in FRP_STYLES if (frp or 0) < top)

    folders: dict[str, list[str]] = {}
    for f in features:
        p = f["properties"]
        lon, lat = f["geometry"]["coordinates"][:2]
        rows = "".join(f"<tr><td>{escape(label)}</td><td>{escape(str(p.get(k)))}</td></tr>"
                       for k, label in KML_FIELDS if p.get(k) is not None)
        ring = footprint(lon, lat, p.get("scan_km"), p.get("track_km"))
        geom = f"<Point><coordinates>{lon:.5f},{lat:.5f}</coordinates></Point>"
        if ring:
            coords = " ".join(f"{x:.5f},{y:.5f}" for x, y in ring)
            geom = (f"<MultiGeometry>{geom}<Polygon><outerBoundaryIs><LinearRing><coordinates>{coords}"
                    f"</coordinates></LinearRing></outerBoundaryIs></Polygon></MultiGeometry>")
        when = p.get("acq_datetime_utc") or ""
        folders.setdefault(str(p.get("platform") or "Unknown"), []).append(
            f"<Placemark><name>{escape(str(p.get('platform')))} {escape(when[:16].replace('T', ' '))}</name>"
            f"<TimeStamp><when>{escape(when)}</when></TimeStamp><styleUrl>#{style_of(p.get('frp'))}</styleUrl>"
            f"<description><![CDATA[<table>{rows}</table>]]></description>{geom}</Placemark>")
    styles = "".join(f'<Style id="{sid}"><IconStyle><color>{col}</color><scale>0.6</scale><Icon><href>'
                     "https://maps.google.com/mapfiles/kml/shapes/shaded_dot.png</href></Icon></IconStyle>"
                     f"<LineStyle><color>{col}</color><width>1</width></LineStyle>"
                     f"<PolyStyle><color>66{col[2:]}</color></PolyStyle></Style>" for _, sid, col in FRP_STYLES)
    body = "".join(f"<Folder><name>{escape(name)}</name>{''.join(marks)}</Folder>"
                   for name, marks in sorted(folders.items()))
    credit = ("Fire data: NASA FIRMS (MODIS C6.1, VIIRS 375 m). Footprints are approximate: scan × track "
              "kilometres around the pixel centre.")
    return (f'<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document>'
            f"<name>{escape(title)}</name><description>{escape(credit)}</description>{styles}{body}"
            "</Document></kml>\n").encode()


def _calendar(body: ExportRequest, request: Request, start: str, end: str) -> Response:
    cal = calendar_payload(request, body.aoi, start, end, body.view, body.metric)
    if body.format == "json":
        return _file(json.dumps(cal).encode(), "json", "calendar", start, end)
    origin = cal.get("origin")
    rows = []
    for i, y in enumerate(cal["years"]):
        for j, m in enumerate(cal["months"]):
            if not start <= f"{y}-{m:02d}" <= end:
                continue
            v = cal["matrix"][i][j]
            o = origin[i][j] if origin else None
            rows.append([y, m, "" if v is None else v, o or ""])
    return _file(_csv(["year", "month", "value", "origin"], rows), "csv", "calendar", start, end)


def _grid(body: ExportRequest, request: Request, start: str, end: str) -> Response:
    today = _today(request)
    first, last = parse_ym(start), parse_ym(end)
    _check_months(first, last, today)
    aoi = _resolve(request, body.aoi, LIMIT_GRID_KM2, "grid exports")
    if body.format == "geotiff" and aoi.bbox[0] > aoi.bbox[2]:
        raise ApiError(422, "invalid_aoi", "GeoTIFF exports can't cross the 180° meridian; export each side.")
    reader = Reader(request.app.state.data, aoi.cell_ids, today)
    values, observed = reader.per_cell(body.view, body.metric, first, last)
    if body.aggregate == "monthly" and len(observed) > MAX_BANDS:
        raise ApiError(422, "too_large", f"{len(observed)} months; monthly exports are limited to {MAX_BANDS}.",
                       {"months": len(observed), "limit_months": MAX_BANDS})

    ids = aoi.cell_ids.astype(np.int64)
    if body.aggregate == "sum":
        totals = values.groupby("cell_id")["value"].sum()
        layers = {"sum": totals.reindex(ids, fill_value=0.0).to_numpy() if observed else np.full(ids.size, np.nan)}
    else:
        layers = {}
        for y, m in observed:
            month = values[(values["year"] == y) & (values["month"] == m)].set_index("cell_id")["value"]
            layers[f"{y}-{m:02d}"] = month.reindex(ids, fill_value=0.0).to_numpy()

    tags = {"data_version": request.app.state.data.data_version(), "view": body.view, "metric": body.metric,
            "unit": UNITS[(body.view, body.metric)], "start": start, "end": end}
    if body.format == "csv":
        return _file(_grid_csv(ids, layers, body.aggregate), "csv", "grid", start, end)
    return _file(_geotiff(aoi, ids, layers, tags), "geotiff", "grid", start, end)


def _grid_csv(ids: np.ndarray, layers: dict, aggregate: str) -> bytes:
    if len(layers) * ids.size > MAX_CSV_ROWS:
        raise ApiError(422, "too_large", "Too many cell-months for a CSV; use GeoTIFF or a shorter period.",
                       {"rows": len(layers) * int(ids.size), "limit_rows": MAX_CSV_ROWS})
    centres = [cells.cell_center(int(c)) for c in ids]
    if aggregate == "sum":
        vals = layers.get("sum", np.full(ids.size, np.nan))
        rows = [[int(c), lat, lon, "" if np.isnan(v) else round(float(v), 3)] for c, (lat, lon), v in zip(ids, centres, vals)]
        return _csv(["cell_id", "cell_lat", "cell_lon", "value"], rows)
    rows = []
    for label, vals in layers.items():
        y, m = int(label[:4]), int(label[5:])
        rows += [[int(c), lat, lon, y, m, round(float(v), 3)] for c, (lat, lon), v in zip(ids, centres, vals)]
    return _csv(["cell_id", "cell_lat", "cell_lon", "year", "month", "value"], rows)


def _geotiff(aoi, ids: np.ndarray, layers: dict, tags: dict) -> bytes:
    """Cloud-Optimized GeoTIFF on the 0.1° grid, clipped to the AOI's bbox; cells outside the AOI are nodata."""
    if not layers:
        raise ApiError(422, "out_of_range", "No observed months in this period.")
    rows, cols = ids // cells.N_COLS, ids % cells.N_COLS
    r0, r1, c0, c1 = int(rows.min()), int(rows.max()), int(cols.min()), int(cols.max())
    height, width = r1 - r0 + 1, c1 - c0 + 1
    pixels = height * width * len(layers)
    if pixels > MAX_TIFF_PIXELS:
        raise ApiError(422, "too_large", "This area's extent is too large for one GeoTIFF; export a smaller or "
                       "more compact area, fewer months, or aggregate: sum.",
                       {"pixels": pixels, "limit_pixels": MAX_TIFF_PIXELS})
    # Exact edges: (index − offset) / 10 avoids drift from adding 0.1 repeatedly.
    transform = from_origin((c0 - 1800) / 10, (r1 + 1 - 900) / 10, 0.1, 0.1)
    data = np.full((len(layers), height, width), NODATA, dtype=np.float32)
    for b, vals in enumerate(layers.values()):
        v = np.where(np.isnan(vals), NODATA, vals).astype(np.float32)
        data[b, r1 - rows, cols - c0] = v  # raster row 0 is the northern edge

    profile = {"driver": "GTiff", "width": width, "height": height, "count": len(layers), "dtype": "float32",
               "crs": "EPSG:4326", "transform": transform, "nodata": NODATA}
    with MemoryFile() as staging, MemoryFile() as out:
        with staging.open(**profile) as ds:
            ds.write(data)
            ds.update_tags(**tags)
            for b, label in enumerate(layers, start=1):
                ds.set_band_description(b, label)
        rasterio.shutil.copy(staging.name, out.name, driver="COG", COMPRESS="DEFLATE")
        return out.read()


@router.get("/validation")
def validation(request: Request):
    path = request.app.state.data.root / "validation" / "validation.json"
    if not path.exists():
        raise ApiError(503, "data_unavailable", "Validation results are not built yet.", {"dataset": "validation"})
    return JSONResponse(json.loads(path.read_text()))
