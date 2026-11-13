# API contract

Version 1.0.1 · 2026-11-03

Base path: `/api`. JSON in, JSON out (UTF-8), except file downloads from `/export`. The backend returns the **same shapes on mock and real data**. The FIRMS MAP_KEY lives only on the backend and is never sent to the browser.

## 1. Shared types

### 1.1 Area of interest (`aoi`)

Every query takes exactly one of these. The backend turns all of them into one polygon.

```jsonc
{ "type": "polygon", "geometry": { "type": "Polygon", "coordinates": [[[31.0,30.5],[31.6,30.5],[31.6,31.2],[31.0,31.2],[31.0,30.5]]] } }  // or MultiPolygon
{ "type": "bbox",    "bbox": [31.0, 30.5, 31.6, 31.2] }             // [west, south, east, north]; west > east crosses 180°
{ "type": "point",   "lat": 30.8, "lon": 31.3, "radius_km": 50 }     // radius 1..500
{ "type": "admin",   "admin_id": "EGY-ADM1-..." }                   // from /api/admin
{ "type": "region",  "region_id": "nile-delta" }                    // from /api/regions
```

Limits (else `422 too_large` / `422 invalid_aoi`):

| Limit | Value |
|---|---|
| Polygon vertices | ≤ 2 000 |
| AOI area for `/calendar`, `/stats`, `/export` grid | ≤ 5 000 000 km² |
| AOI area for `/hotspots`, `/nrt`, `/export` hotspots | ≤ 500 000 km² |
| Date span for `/hotspots` and hotspot exports | ≤ 366 days |

### 1.2 Enums

| Name | Values | Default |
|---|---|---|
| `view` | `harmonized`, `modis`, `viirs` | `harmonized` |
| `metric` | `detections`, `fire_days` | `detections` |
| `status` | `unusual_high` (z ≥ 2), `above_normal` (1 ≤ z < 2), `normal`, `below_normal` (z ≤ −1); see §2.4 when `z` is null | |
| `sensor` | `MODIS`, `VIIRS` | |
| `platform` | `Terra`, `Aqua`, `SNPP`, `NOAA20`, `NOAA21` | |

Raw views use **one platform per month**, so two satellites never add up to a fake doubling: `modis` = Aqua raw values (Terra before 2002-07); `viirs` = SNPP raw values (null before 2012-02; NOAA-20 from 2026-11, since S-NPP ended on 2026-11-02). They exist to show *why* harmonization is needed; the UI must warn that raw views are not comparable across 2012.

### 1.3 Months and nulls

- Months are `"YYYY-MM"`. Ranges are inclusive: `start: "2001-01", end: "2026-10"`.
- In any count: **`null` = not observed** (before the sensor existed, or in the future); **`0` = observed, nothing detected**.

### 1.4 `meta` (on every JSON response)

```json
"meta": {
  "data_version": "mock-20261103",
  "generated_at": "2026-11-03T14:02:11Z",
  "aoi": { "area_km2": 4454.0, "cells": 42, "bbox": [31.0, 30.5, 31.6, 31.2], "coarse_warning": false }
}
```

`coarse_warning` is true when the AOI holds fewer than 4 cell centres (`grid.md` §5). Endpoints without an AOI omit `meta.aoi`.

### 1.5 Errors

```json
{ "error": { "code": "too_large", "message": "Area is 812 000 km²; the limit for hotspots is 500 000 km².", "details": { "area_km2": 812000 } } }
```

| HTTP | `code` | When |
|---|---|---|
| 400 | `bad_request` | Malformed JSON, missing field, bad enum |
| 404 | `not_found` | Unknown `region_id` / `admin_id` |
| 422 | `invalid_aoi` | Self-intersecting polygon, empty area, too many vertices |
| 422 | `too_large` | Area or date span over the limits |
| 422 | `out_of_range` | Month outside the covered period |
| 502 | `upstream_error` | FIRMS or Nominatim failed |
| 503 | `data_unavailable` | Harmonized data not loaded yet |

## 2. Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | Liveness + data version |
| GET | `/api/regions` | Demo regions (shortcuts in the UI) |
| POST | `/api/calendar` | Years × months matrix |
| POST | `/api/stats` | One month against its history |
| POST | `/api/hotspots` | Individual detections as GeoJSON |
| POST | `/api/nrt` | Last 1–10 days, live from FIRMS |
| POST | `/api/export` | File download (CSV, GeoJSON, GeoTIFF) |
| GET | `/api/search` | Place search |
| GET | `/api/admin` | Administrative boundaries |
| GET | `/api/validation` | Harmonization validation results |

### 2.1 `GET /api/health`

```json
{ "status": "ok", "data_version": "mock-20261103", "uptime_s": 5321,
  "sources": { "harmonized": true, "points": true, "nrt": false } }
```

### 2.2 `GET /api/regions`

```json
{
  "regions": [
    { "region_id": "nile-delta", "name": "Nile Delta", "country": "Egypt",
      "bbox": [29.9, 30.0, 32.3, 31.6],
      "geometry": { "type": "Polygon", "coordinates": [[[29.9,30.0],[32.3,30.0],[32.3,31.6],[29.9,31.6],[29.9,30.0]]] },
      "default_month": "2026-10",
      "story": "Rice-straw burning season, October to November." },
    { "region_id": "rio-negro", "name": "Río Negro", "country": "Argentina",
      "bbox": [-71.8, -41.8, -68.0, -39.5],
      "geometry": { "type": "Polygon", "coordinates": [[[-71.8,-41.8],[-68.0,-41.8],[-68.0,-39.5],[-71.8,-39.5],[-71.8,-41.8]]] },
      "default_month": "2026-07",
      "story": "July 2026 fire event in Río Negro and Chile." }
  ],
  "meta": { "data_version": "mock-20261103", "generated_at": "2026-11-03T14:02:11Z" }
}
```

Region geometries above are placeholders; the final shapes are set when the regions are built.

### 2.3 `POST /api/calendar`

Request:

```json
{ "aoi": { "type": "region", "region_id": "nile-delta" },
  "start": "2001-01", "end": "2026-10",
  "view": "harmonized", "metric": "detections" }
```

Response:

```json
{
  "view": "harmonized",
  "metric": "detections",
  "unit": "VIIRS-equivalent detections per month",
  "years": [2001, 2002, "…", 2026],
  "months": [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  "matrix": [[12, 9, 7, 14, 22, 35, 31, 25, 70, 210, 265, 52], "…", [15, 11, 9, 16, 30, 41, 33, 28, 88, 412, null, null]],
  "origin": [["converted_terra", "…"], "…", ["observed_snpp", "…", null, null]],
  "year_totals": [752, "…", 683],
  "month_medians": [13, 10, 8, 15, 25, 38, 31, 26, 75, 228, 270, 55],
  "max": 412,
  "partial_month": null,
  "meta": { "...": "see §1.4" }
}
```

- `matrix[i][j]` = value for `years[i]`, `months[j]`; integers (rounded half up); `null` outside `start..end` or not observed.
- `origin` has the same shape as `matrix` (harmonized view only; omitted for raw views).
- `year_totals` sums non-null values; `month_medians` uses all years with a value in that month.
- `partial_month` is `null`, or `{ "month": "2026-11", "days_observed": 14 }` when `end` is the current month.

### 2.4 `POST /api/stats`

Request:

```json
{ "aoi": { "type": "region", "region_id": "rio-negro" },
  "month": "2026-07",
  "baseline": [2001, 2025],
  "view": "harmonized", "metric": "detections" }
```

`baseline` is a year range (inclusive, default 2001 → last complete year). The target year is always excluded from its own baseline.

Response:

```json
{
  "month": "2026-07",
  "value": 512.4,
  "baseline": {
    "years": [2001, 2025],
    "n_years": 25,
    "mean": 41.3, "median": 36.0, "sd": 14.9, "min": 12.0, "max": 88.0,
    "values": [{ "year": 2001, "value": 31.0 }, "…"]
  },
  "percentile": 100,
  "rank": 1,
  "z": 31.6,
  "ratio_to_median": 14.2,
  "status": "unusual_high",
  "partial": null,
  "trend": { "sen_slope_per_year": 1.8, "p_value": 0.04, "series": "annual_totals" },
  "meta": { "...": "see §1.4" }
}
```

- `percentile` = % of baseline years with a strictly lower value (0..100, integer).
- `rank` = 1 for the highest value among baseline years + the target year.
- `z` = (value − mean) / sd (sample sd); `null` when sd = 0.
- `status` from `z` as in §1.2, with two cases where `z` cannot decide:
  - fewer than 3 baseline years: `status` is `null` (not enough history to say what is normal);
  - `sd` = 0 (every baseline year had the same value, e.g. 0): compare `value` with `mean` directly: equal → `normal`, higher → `unusual_high`, lower → `below_normal`.
- `partial`, for the current month: `{ "days_observed": 14, "comparison": "same_days_previous_years" }`. Each baseline year's value is then scaled to the same day range (days 1..`days_observed`), as described in `data-products.md` §5.
- Floats are rounded to 1 decimal.

### 2.5 `POST /api/hotspots`

Request:

```json
{ "aoi": { "type": "bbox", "bbox": [31.0, 30.5, 31.6, 31.2] },
  "start": "2026-10-01", "end": "2026-10-31",
  "sensors": ["MODIS", "VIIRS"],
  "include_filtered": false,
  "limit": 5000 }
```

- `start`/`end` are **dates** here (≤ 366 days).
- `include_filtered: false` drops low-confidence and non-vegetation points (the same filter the grid uses).
- `limit` default 5 000, max 50 000. Points are returned newest first; `truncated` tells the UI there were more.

Response: GeoJSON FeatureCollection plus members `truncated`, `total`, `meta`.

```json
{
  "type": "FeatureCollection",
  "features": [
    { "type": "Feature",
      "geometry": { "type": "Point", "coordinates": [31.2147, 30.9021] },
      "properties": {
        "point_id": "9f2c41aa0b7d13e5",
        "sensor": "VIIRS", "platform": "NOAA20",
        "acq_datetime_utc": "2026-10-14T11:24:00Z", "daynight": "D",
        "frp": 6.4, "confidence_class": "nominal", "confidence_pct": null,
        "fire_type": 0, "brightness_k": 331.2, "scan_km": 0.41, "track_km": 0.38,
        "cell_id": 4354512, "source": "archive" } }
  ],
  "total": 1287, "truncated": false,
  "meta": { "...": "see §1.4" }
}
```

Outside the demo regions, the backend fetches points from the FIRMS area API on demand (`source: "archive"` or `"nrt"` as FIRMS labels them); same response shape.

### 2.6 `POST /api/nrt`

```json
{ "aoi": { "type": "point", "lat": -40.8, "lon": -69.0, "radius_km": 150 }, "days": 7, "sensors": ["VIIRS"] }
```

`days` 1..10. Response: same as `/hotspots`, with `source: "nrt"` and `meta.fetched_at`. Cached on the backend for 15 minutes per (AOI, days, sensors).

### 2.7 `POST /api/export`

```json
{ "aoi": { "type": "region", "region_id": "nile-delta" },
  "what": "calendar", "format": "csv",
  "start": "2001-01", "end": "2026-10",
  "view": "harmonized", "metric": "detections",
  "aggregate": "sum" }
```

| `what` | `format` | `start`/`end` | Content |
|---|---|---|---|
| `hotspots` | `csv`, `geojson` | dates (≤ 366 days) | Points with the §2.5 properties; CSV adds `lat`, `lon` columns |
| `calendar` | `csv`, `json` | months | CSV in long form: `year,month,value,origin`; JSON = the `/calendar` response |
| `grid` | `geotiff`, `csv` | months | Harmonized values per cell in the AOI |

GeoTIFF rules:
- Cloud-Optimized GeoTIFF, EPSG:4326, 0.1° pixels aligned to the grid, `float32`, nodata = `-1`.
- Clipped to the AOI bbox; cells whose centre is outside the AOI are nodata.
- `aggregate: "sum"` → one band, the total over `start..end`. `aggregate: "monthly"` → one band per month (max 120), band descriptions `"YYYY-MM"`.
- Tags: `data_version`, `view`, `metric`, `unit`, `start`, `end`.

Response: the file, with `Content-Disposition: attachment; filename="almatafi_{what}_{start}_{end}.{ext}"`. Content types: `text/csv`, `application/geo+json`, `application/json`, `image/tiff; application=geotiff; profile=cloud-optimized`.

### 2.8 `GET /api/search?q=Kafr%20El%20Sheikh&limit=5`

Proxies Nominatim (with a proper User-Agent and ≤ 1 request/second), cached 24 h.

```json
{ "results": [
    { "name": "Kafr El Sheikh", "display_name": "Kafr El Sheikh, Egypt", "kind": "state",
      "centroid": [30.94, 31.25], "bbox": [30.4, 31.0, 31.4, 31.6],
      "geometry": { "type": "Polygon", "coordinates": ["…"] } } ] }
```

`centroid` is `[lon, lat]`. `geometry` is simplified to ≤ 2 000 vertices, or `null` when Nominatim gives only a point (the UI then offers a radius).

### 2.9 `GET /api/admin?country=EGY&level=1`

geoBoundaries ADM0–ADM2, simplified. Response: GeoJSON FeatureCollection; each feature's properties: `{ "admin_id", "name", "level", "country" }`. `admin_id` is the geoBoundaries `shapeID`.

### 2.10 `GET /api/validation`

Returns `data/validation/validation.json` (`data-products.md` §4) unchanged.

## 3. Shareable URL (frontend)

The Explorer keeps its state in the query string so a link reproduces the view:

```
/explore?aoi=region:nile-delta&start=2001-01&end=2026-10&view=harmonized&metric=detections&sel=2026-10
```

`aoi` forms: `region:{id}`, `bbox:{w},{s},{e},{n}`, `point:{lat},{lon},{radius_km}`, `admin:{id}`, `poly:{encoded}` where `{encoded}` is the polygon's outer ring as a Google encoded polyline (precision 5).

## Changelog

- 1.0.1 (2026-11-03): fixed worked examples (hotspot `cell_id`, 2001 `year_total`, `meta.aoi` area and cell count); bbox west > east crosses 180°; raw views use one platform per month; `status` when `z` is null; how a partial month's baseline is scaled.
- 1.0 (2026-11-01): first version.
