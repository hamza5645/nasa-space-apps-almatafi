from __future__ import annotations

import os
from datetime import date
from dataclasses import dataclass, field
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]


@dataclass(frozen=True)
class Settings:
    data_dir: Path = field(default_factory=lambda: Path(os.environ.get("ALMATAFI_DATA_DIR", REPO / "data")))
    cors_origins: tuple[str, ...] = field(default_factory=lambda: tuple(
        o.strip() for o in os.environ.get("ALMATAFI_CORS_ORIGINS", "http://localhost:3000").split(",") if o.strip()))
    # FIRMS MAP_KEY: backend only, never sent to the browser (api.md).
    firms_map_key: str | None = field(default_factory=lambda: os.environ.get("FIRMS_MAP_KEY") or None)
    nominatim_url: str = field(default_factory=lambda: os.environ.get(
        "ALMATAFI_NOMINATIM_URL", "https://nominatim.openstreetmap.org/search"))
    # Nominatim's policy asks for a way to reach the app's operator in the User-Agent.
    contact: str = field(default_factory=lambda: os.environ.get(
        "ALMATAFI_CONTACT", "https://github.com/khalidstark/nasa-space-apps-modis"))
    geoboundaries_url: str = field(default_factory=lambda: os.environ.get(
        "ALMATAFI_GEOBOUNDARIES_URL", "https://www.geoboundaries.org/api/current/gbOpen"))
    # Fixed "today" for tests and demos; None means the real UTC date.
    today: date | None = None
