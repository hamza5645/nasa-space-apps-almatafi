# backend

FastAPI app implementing `contracts/api.md`. Reads the files the pipeline writes under `data/`.

```
uv sync
uv run pytest
uv run uvicorn app.main:app --reload      # http://localhost:8000/api/health · docs at /api/docs
```

Settings (environment variables):

| Variable | Default | |
|---|---|---|
| `ALMATAFI_DATA_DIR` | `../data` | where `clean/`, `grid/`, `harmonized/`, `admin/` live |
| `ALMATAFI_CORS_ORIGINS` | `http://localhost:3000` | comma list; add the Vercel URL when deployed |
| `FIRMS_MAP_KEY` | none | FIRMS API key for `/nrt`; stays on the server |

## Areas of interest (`app/aoi.py`)

All five AOI forms (polygon, bbox, point + radius, admin, region) become one polygon. On that polygon:
- **Checks:** at most 2,000 vertices, valid shape, latitudes in range, radius 1–500 km.
- **Area:** geodesic area on WGS84.
- **Cells:** the 0.1° cells whose centre is inside. If fewer than 4, it uses the cells it touches and sets `coarse_warning`.
- **Antimeridian:** shapes crossing 180° are split, and their bbox is written with west > east (RFC 7946). Longitudes past ±180 (as MapLibre can produce) are folded back.
- **Poles:** a circle around a pole is closed along the pole, so it keeps its true size.

Endpoints then call `aoi.check_area(LIMIT_GRID_KM2 | LIMIT_POINTS_KM2, "…")` for the size limits. Admin shapes are read from `data/admin/*.geojson` (features with an `admin_id` property); B3 fills that folder from geoBoundaries.

## Endpoints (B2)

| Endpoint | Reads | Notes |
|---|---|---|
| `POST /api/calendar` | `harmonized/harmonized_monthly.parquet` (view `harmonized`) or `grid/` (views `modis`, `viirs`) | AOI ≤ 5M km². Values are ints, rounded half up. `null` = not observed (no coverage, raw VIIRS before 2012-02, outside the harmonized covered period, future). |
| `POST /api/stats` | same | Baseline excludes the target year. z uses the sample sd. A current, partial month is compared with the same days of past years. |
| `POST /api/hotspots` | `clean/` points | AOI ≤ 500k km², ≤ 366 days, newest first. `include_filtered: false` applies the grid's filter (MODIS ≥ 30, VIIRS not low, type 0, static mask). |

Until H1/H2 write `harmonized_monthly.parquet`, the harmonized view answers **503 `data_unavailable`**; the raw views work on mock now. H2 should store `covered_start` / `covered_end` (`"YYYY-MM"`) in that file's metadata. Without them, the covered period is taken from the data.

Choices the contract leaves open:
- **Raw fire days:** fire days can't be added across platforms, so each cell takes its best platform and pass. That's a lower bound on distinct fire days.
- **Harmonized origin:** the month's `origin` is the origin carrying most of the value in the AOI. Where there's no row, it comes from the era: Terra before 2002-07, Aqua before 2012-02, S-NPP after.
- **Partial months:** `days_observed` is the last UTC day with any hotspot (any platform). Past years are scaled by their own share of filtered detections on days 1..N in the AOI.
- **No spread:** when the baseline has sd = 0, `z` is `null` and `status` compares the value with the mean.

## Exports and validation (B3a)

`POST /api/export` returns a file with `Content-Disposition: attachment; filename="almatafi_{what}_{start}_{end}.{ext}"`:

| `what` | `format` | `start` / `end` | Content |
|---|---|---|---|
| `hotspots` | `csv`, `geojson` | dates, ≤ 366 days | every point (no `limit`), same properties as `/hotspots`; CSV adds `lat`, `lon` |
| `calendar` | `csv`, `json` | months | CSV `year,month,value,origin`; JSON is exactly the `/calendar` response |
| `grid` | `geotiff`, `csv` | months | per cell in the AOI, any `view`; `aggregate: sum` (one band) or `monthly` (≤ 120 bands named `YYYY-MM`) |

**GeoTIFF:**
- **Format:** Cloud-Optimized (DEFLATE), EPSG:4326, `float32`, nodata `-1`.
- **Grid:** pixels are exactly the 0.1° grid cells. Each pixel centre equals `cell_center(cell_id)`, and the extent is clipped to the AOI's cells. Cells whose centre is outside the AOI are nodata.
- **Tags:** `data_version`, `view`, `metric`, `unit`, `start`, `end`.
- **Size:** at most 10M pixels (bands × the AOI's extent in cells; ~250 MB of memory at the cap).
- **180° meridian:** AOIs crossing it are refused for GeoTIFF; export each side.

`GET /api/validation` serves `data/validation/validation.json` as it is (H3), or answers 503 until it exists.

## Place search (B3b)

`GET /api/search?q=Kafr%20El%20Sheikh&limit=5` proxies Nominatim:

- **Usage policy:** an identifying User-Agent (`almatafi/0.1 (NASA Space Apps Cairo; $ALMATAFI_CONTACT)`), at most 1 request per second across the whole server, and results cached 24 h by normalized query and limit.
- **Results:** `name`, `display_name`, `kind`, `centroid` `[lon, lat]`, `bbox` `[w, s, e, n]`, and `geometry` (polygons simplified to ≤ 2,000 vertices; `null` for points and lines, so the UI offers a radius).
- **Errors:** any upstream failure becomes `502 upstream_error` with a generic message and is not cached.
- **Settings:** `ALMATAFI_NOMINATIM_URL` (default `https://nominatim.openstreetmap.org/search`), `ALMATAFI_CONTACT`. Before the public demo, set the contact to a real email, as Nominatim asks.

## Admin boundaries (B3c)

`GET /api/admin?country=EGY&level=1` (levels 0–2) returns a GeoJSON FeatureCollection from geoBoundaries (gbOpen). Each feature's properties are `{admin_id, name, level, country}`; `admin_id` is the geoBoundaries `shapeID`.

- **Caching:** each country and level is fetched once and saved to `data/admin/{ISO}_ADM{n}.geojson`. Fetched boundaries work right away as `{"type": "admin", "admin_id": …}` AOIs in every endpoint, and after a restart too.
- **Safety:** downloads go only over https to geoBoundaries' or GitHub's hosts, checked on every redirect, and are capped at 60 MB. Polygons are simplified to ≤ 2,000 vertices.
- **Errors:** unknown country → 404; upstream failure → 502.
- **Prefetch before the demo** (no request waits for a download then): `uv run python -m app.admin EGY:1 ARG:1 CHL:1`.

## Live hotspots (X6, `/api/nrt`)

`POST /api/nrt` with `{aoi, days (1–10, default 7), sensors, include_filtered, limit}` returns the last days of hotspots anywhere, live from the FIRMS area API, in the `/hotspots` shape plus `source: "nrt"` and `meta.fetched_at`.

- **Request splitting:** FIRMS serves at most 5 days per request, so 7 days is 5 + 2. Sources: `MODIS_NRT` and the three VIIRS NRT products. An AOI crossing 180° is queried as two boxes, never more.
- **Same rows as the archive:** rows go through the pipeline's `clean()` (same checks, same `point_id`) and the grid's filter (MODIS confidence ≥ 30, no VIIRS `low`, the static-source mask), then the exact AOI shape.
- **Limits:**
  - AOI ≤ 500,000 km², checked before any request.
  - Answers are cached 15 minutes, up to 32 of them.
  - The backend allows itself 1,000 FIRMS transactions per 10 minutes (FIRMS allows 5,000) and answers 503 `upstream_busy` past that.
- **Errors:**
  - No `FIRMS_MAP_KEY`: 503 `data_unavailable`, and `/api/health` shows `sources.nrt: false`.
  - FIRMS errors, "Invalid MAP_KEY.", HTML pages and network failures: 502 `upstream_error`.
- **Key:** it never reaches a response or a log line.
- **Testing:** tested against a fake FIRMS only.

Contract note: api.md's `days` 1–10 is kept by splitting requests; `include_filtered` and `limit` are new and work like `/hotspots`.

## On-demand hotspots (X10)

Points are stored for the demo regions only (PLAN §3). When `/api/hotspots` (or a hotspot export) finds no stored points, the server has `FIRMS_MAP_KEY`, and the span is ≤ 31 days, it fetches the points from the FIRMS area API instead. The response then has `on_demand: true`.

- **Products:** FIRMS's `data_availability` (cached 6 h) says where standard processing ends. Earlier days use the standard products (`MODIS_SP`, `VIIRS_*_SP`), later days the NRT ones. If that call fails, standard data is assumed to end 120 days back.
- **Cost:** no request goes out for a satellite before it flew, and rows are labelled `archive` or `nrt` from their version. A month costs about 28 FIRMS transactions.
- **Limits:** the same as `/nrt` (budget, query box cap, byte cap, the key never logged), and answers are cached.
- **Without a key, or beyond 31 days:** the answer is the old 503 `data_unavailable`.

## OpenAPI snapshot (X7)

`contracts/openapi.json` is the API's OpenAPI schema, generated from the code: `python -m app.openapi`. `tests/test_openapi.py` fails when it's stale, so any change to a request or response shows up in the PR. The frontend can generate TypeScript types from it (`npx openapi-typescript ../contracts/openapi.json -o lib/api-types.ts`). Live docs: `/api/docs`.

## Deploy (X2)

```
docker build -f backend/Dockerfile -t almatafi-api .     # from the repo root, ~2 min
docker run -p 8000:8000 almatafi-api                     # http://localhost:8000/api/health
```

- **The image:**
  - Python 3.12 with the locked dependencies, running as a non-root user, with a health check.
  - The full **mock data set is built in** (generate → ingest → grid → harmonize + validate), so a fresh deploy works straight away. Image ~1.2 GB; the running API uses ~120 MB of memory.
  - CI builds and smoke-tests it on every push.
- **Hosting:** the image runs on Hamza's VPS under rootless Podman, behind a Cloudflare Tunnel (`deploy/README.md`). Its env vars live in `api.env` there: `ALMATAFI_CORS_ORIGINS`, `ALMATAFI_CONTACT`, `FIRMS_MAP_KEY`, and, from Nov 13, `ALMATAFI_DATA_URL` / `ALMATAFI_DATA_SHA256`.
- **Real data:** at start-up, `app/bootstrap.py` downloads the bundle at `ALMATAFI_DATA_URL` (https only, ≤ 4 GB). It verifies `ALMATAFI_DATA_SHA256` **before** unpacking, unpacks safely, and swaps in only the product folders in the bundle. If anything is wrong, the container exits instead of serving wrong data. Make a bundle with:

  ```
  uv run python -m app.cache          # refresh the demo-region cache for the new data
  tar -czf almatafi-data.tar.gz -C data clean grid harmonized validation admin cache
  shasum -a 256 almatafi-data.tar.gz
  ```

## Demo-region cache (X3)

`python -m app.cache [--today YYYY-MM-DD]` saves the real endpoint responses for each demo region as static JSON in `data/cache/`:

| File | Content |
|---|---|
| `index.json` | regions, `data_version`, when the cache was made, file sizes |
| `{region_id}.json` | `region`; `calendar[view][metric]` (6 calendars); `stats["YYYY-MM"]` for every observed month; `hotspots["YYYY-MM"]` for the region's `default_month` |
| `validation.json` | `/api/validation`, for the method page |

The shapes are exactly the api.md responses, because the cache is made by calling the endpoints. On the mock: 8 s, 1.0 MB (Nile Delta) + 0.7 MB (Río Negro).

- **Docker:** the image builds the cache for its built-in data.
- **Real data:** a real data bundle should carry its own `cache/`. If it doesn't, the bootstrap deletes the mock cache rather than serve it next to real data.
- **Frontend fallback:** copy `data/cache/` to the frontend's public folder (e.g. `frontend/public/cache/`). When the backend doesn't answer, read `cache/{region_id}.json`. The data is the same; only the source differs.
