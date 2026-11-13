# syntax=docker/dockerfile:1
# Backend image. Build from the repo root:  docker build -f backend/Dockerfile -t almatafi-api .
# The mock data set is built into the image, so a fresh deploy works straight away.
# Real data replaces it at start-up from ALMATAFI_DATA_URL (see app/bootstrap.py).

FROM ghcr.io/astral-sh/uv:0.13.0 AS uv

FROM python:3.12-slim-bookworm AS base
# rasterio's bundled GDAL needs libexpat, which the slim image leaves out.
RUN apt-get update && apt-get install -y --no-install-recommends libexpat1 && rm -rf /var/lib/apt/lists/*
COPY --from=uv /uv /uvx /bin/
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never UV_NO_CACHE=1 \
    UV_PROJECT_ENVIRONMENT=/opt/venv PATH=/opt/venv/bin:$PATH
WORKDIR /app
# Dependencies first, so code changes don't reinstall them.
COPY pipeline/pyproject.toml pipeline/uv.lock pipeline/
COPY backend/pyproject.toml backend/uv.lock backend/
RUN cd backend && uv sync --locked --no-dev --no-install-local
COPY pipeline/almatafi pipeline/almatafi
COPY backend/app backend/app
RUN cd backend && uv sync --locked --no-dev

FROM base AS data
# The full mock pipeline: generate → ingest → grid → harmonize + validate → mock clouds (about a minute).
# Adds matplotlib (the pipeline's locked "plots" extra) for the validation charts; this stage
# is thrown away, so the API image never carries it.
RUN cd pipeline && uv export --locked --no-dev --extra plots --no-hashes --no-emit-project -o /tmp/plots.txt \
 && uv pip install --python /opt/venv/bin/python -r /tmp/plots.txt
RUN python -m almatafi.mock --out /data/raw/mock --messy-year 0 \
 && python -m almatafi.ingest /data/raw/mock/modis/*.csv /data/raw/mock/viirs-*/*.csv \
        --out /data/clean --reports /data/reports --source mock \
 && python -m almatafi.grid --clean /data/clean --out /data/grid --reports /data/reports \
 && python -m almatafi.harmonize --grid /data/grid --out /data/harmonized --validation /data/validation \
        --truth /data/raw/mock/truth --reports /data/reports \
 && python -m almatafi.clouds mock --grid /data/grid --out /data/clouds \
 && rm -rf /data/raw

FROM base AS runtime
RUN useradd --create-home --uid 10001 app && mkdir -p /app/data && chown app /app/data
COPY --from=data --chown=app /data /app/data
USER app
WORKDIR /app/backend
# Demo-region cache for the built-in data (about 10 s).
RUN ALMATAFI_DATA_DIR=/app/data python -m app.cache
ENV ALMATAFI_DATA_DIR=/app/data PORT=8000
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s \
  CMD python -c "import os, urllib.request; urllib.request.urlopen('http://127.0.0.1:%s/api/health' % os.environ['PORT'], timeout=4)"
CMD ["sh", "-c", "python -m app.bootstrap && exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT}"]
