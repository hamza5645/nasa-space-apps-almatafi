"""FastAPI app. Run: uvicorn app.main:app --reload (from backend/)."""

from __future__ import annotations

import time
from datetime import datetime, timezone

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from app import errors
from app.admin import GeoBoundaries
from app.admin import router as admin_router
from app.alerts import router as alerts_router
from app.aoi import AdminStore
from app.config import Settings
from app.data import DataStore
from app.meta import build_meta
from app.nrt import Firms
from app.nrt import router as nrt_router
from app.regions import REGIONS
from app.export import router as export_router
from app.routes import router
from app.search import Nominatim
from app.search import router as search_router


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings()
    app = FastAPI(title="Almatafi API", version="0.1.0", docs_url="/api/docs", openapi_url="/api/openapi.json")
    app.state.settings = settings
    app.state.data = DataStore(settings.data_dir)
    app.state.admin = AdminStore(settings.data_dir / "admin")
    app.state.boundaries = GeoBoundaries(settings.geoboundaries_url, settings.data_dir / "admin")
    app.state.regions = REGIONS
    app.state.search = Nominatim(settings.nominatim_url, f"almatafi/0.1 (NASA Space Apps Cairo; {settings.contact})")
    app.state.firms = Firms(settings.firms_map_key)
    app.state.started = time.monotonic()
    app.state.today = lambda: settings.today or datetime.now(timezone.utc).date()
    app.add_middleware(CORSMiddleware, allow_origins=list(settings.cors_origins),
                       allow_methods=["GET", "POST"], allow_headers=["*"])
    errors.install(app)

    @app.get("/api/health")
    def health(request: Request):
        data: DataStore = request.app.state.data
        return {
            "status": "ok",
            "data_version": data.data_version(),
            "uptime_s": int(time.monotonic() - request.app.state.started),
            "sources": {
                "harmonized": data.harmonized.exists(),
                "points": data.has_points(),
                "nrt": settings.firms_map_key is not None,
            },
        }

    @app.get("/api/regions")
    def regions(request: Request):
        return {"regions": list(request.app.state.regions.values()),
                "meta": build_meta(request.app.state.data.data_version())}

    app.include_router(router)
    app.include_router(export_router)
    app.include_router(search_router)
    app.include_router(admin_router)
    app.include_router(nrt_router)
    app.include_router(alerts_router)
    return app


app = create_app()
