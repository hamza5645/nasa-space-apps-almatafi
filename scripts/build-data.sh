#!/usr/bin/env bash
# Build every data product, the demo cache and a deployable bundle, in one go.
#
#   scripts/build-data.sh mock          # rehearsal on the mock data (no network)
#   scripts/build-data.sh real          # from data/raw/firms/ (already downloaded)
#   scripts/build-data.sh real --fetch  # download first (FIRMS_MAP_KEY for this year, NOAA-21, NRT)
#
# Runbook: docs/runbook.md. Output: data/{clean,grid,harmonized,validation,cache},
# frontend/public/cache/, and dist/almatafi-data.tar.gz with its SHA-256 for the backend's
# ALMATAFI_DATA_URL / ALMATAFI_DATA_SHA256 (backend/app/bootstrap.py).
# Options (env): DATA_DIR, DIST_DIR, COUNTRIES, API_COUNTRIES, YEARS, SKIP_ADMIN=1, FRONTEND_CACHE=0.
set -euo pipefail

MODE=${1:-}
FETCH=${2:-}
ROOT=$(cd "$(dirname "$0")/.." && pwd)
DATA=${DATA_DIR:-$ROOT/data}          # DATA_DIR=… builds somewhere else (rehearsals)
DIST=${DIST_DIR:-$ROOT/dist}
# Country files (FIRMS spellings) cover past years; the API (ISO3 codes, same countries) covers
# this year, all of NOAA-21 and the NRT tail.
COUNTRIES=${COUNTRIES:-Egypt,Argentina,Chile}
API_COUNTRIES=${API_COUNTRIES:-EGY,ARG,CHL}
YEARS=${YEARS:-2000-$(( $(date -u +%Y) - 1 ))}

case "$MODE" in mock|real) ;; *) echo "usage: $0 mock|real [--fetch]" >&2; exit 2 ;; esac

py() {  # py pipeline|backend args… : the project's locked env if uv is there, else its .venv
  local dir=$ROOT/$1; shift
  if command -v uv >/dev/null; then (cd "$dir" && uv run --locked --quiet python "$@")
  else (cd "$dir" && .venv/bin/python "$@"); fi
}
step() { printf '\n== %s\n' "$*"; }
t0=$SECONDS

if [ "$MODE" = mock ]; then
  RAW=$DATA/raw/mock
  step "mock FIRMS files → $RAW"
  py pipeline -m almatafi.mock --out "$RAW" --messy-year 0
  FILES=("$RAW"/modis/*.csv "$RAW"/viirs-*/*.csv)
  SOURCE=mock
else
  RAW=$DATA/raw/firms
  if [ "$FETCH" = --fetch ]; then
    step "FIRMS yearly country files ($COUNTRIES, $YEARS) → $RAW"
    py pipeline -m almatafi.fetch --out "$RAW" countries --countries "$COUNTRIES" --years "$YEARS"
    if [ -n "${FIRMS_MAP_KEY:-}" ]; then
      for c in ${API_COUNTRIES//,/ }; do
        step "FIRMS API for $c: this year, NOAA-21, NRT tail"
        py pipeline -m almatafi.fetch --out "$RAW" api --country "$c" --name "$(echo "$c" | tr 'A-Z' 'a-z')"
      done
    else
      echo "FIRMS_MAP_KEY not set: skipping this year, NOAA-21 and the NRT tail." >&2
    fi
  fi
  shopt -s nullglob
  FILES=("$RAW"/*/*.csv)
  shopt -u nullglob
  [ ${#FILES[@]} -gt 0 ] || { echo "no FIRMS files in $RAW; run with --fetch" >&2; exit 1; }
  SOURCE=auto
fi

step "ingest ${#FILES[@]} files → clean points"
rm -rf "$DATA/clean"
py pipeline -m almatafi.ingest "${FILES[@]}" --out "$DATA/clean" --reports "$DATA/reports" --source "$SOURCE"

step "grid"
py pipeline -m almatafi.grid --clean "$DATA/clean" --out "$DATA/grid" --reports "$DATA/reports"

step "harmonize + validate"
TRUTH=()
[ "$MODE" = mock ] && TRUTH=(--truth "$RAW/truth")
py pipeline -m almatafi.harmonize --grid "$DATA/grid" --out "$DATA/harmonized" --validation "$DATA/validation" \
  --reports "$DATA/reports" ${TRUTH[@]+"${TRUTH[@]}"}

if [ "$MODE" = real ] && [ "${SKIP_ADMIN:-0}" != 1 ]; then
  step "admin boundaries for the demo countries"
  ALMATAFI_DATA_DIR=$DATA py backend -m app.admin EGY:1 ARG:1 CHL:1 || echo "admin prefetch failed; the app fetches them on first use" >&2
fi

step "demo-region cache"
py backend -m app.cache --data "$DATA" --out "$DATA/cache"
if [ "${FRONTEND_CACHE:-1}" = 0 ]; then
  echo "FRONTEND_CACHE=0: frontend/public/cache/ left as it is"
elif [ "$DATA" != "$ROOT/data" ]; then
  rm -rf "$ROOT/frontend/public/cache" && mkdir -p "$ROOT/frontend/public/cache" && cp "$DATA"/cache/*.json "$ROOT/frontend/public/cache/"
elif [ -d "$ROOT/frontend/node_modules" ]; then
  (cd "$ROOT/frontend" && node scripts/copy-cache.mjs)
else
  rm -rf "$ROOT/frontend/public/cache" && mkdir -p "$ROOT/frontend/public/cache" && cp "$DATA"/cache/*.json "$ROOT/frontend/public/cache/"
fi

step "bundle"
mkdir -p "$DIST" "$DATA/admin"
BUNDLE=$DIST/almatafi-data-$MODE.tar.gz
tar -czf "$BUNDLE" -C "$DATA" clean grid harmonized validation admin cache
SHA=$(shasum -a 256 "$BUNDLE" | cut -d' ' -f1)
echo "$SHA  $(basename "$BUNDLE")" > "$BUNDLE.sha256"

step "done in $((SECONDS - t0)) s"
echo "bundle: $BUNDLE ($(du -h "$BUNDLE" | cut -f1))"
echo "ALMATAFI_DATA_SHA256=$SHA"
echo "Next: upload the bundle (https), set ALMATAFI_DATA_URL and ALMATAFI_DATA_SHA256 on the backend,"
echo "and commit frontend/public/cache/ so the site's offline copy matches."
