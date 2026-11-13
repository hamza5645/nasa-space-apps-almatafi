"""Satellite platforms: sensor, FIRMS spelling, data start and overpass times.

Implements contracts/firms-input.md §4.1 and §5.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date


@dataclass(frozen=True)
class Platform:
    name: str            # normalised platform name used everywhere after ingest
    sensor: str          # MODIS / VIIRS
    satellite: str       # how FIRMS archive files spell it in the `satellite` column
    start: date          # first usable FIRMS records
    day_pass: float      # local solar time of the daytime overpass, hours
    night_pass: float    # local solar time of the night overpass, hours
    end: date | None = None  # last day with data, if the platform has stopped


PLATFORMS = {
    p.name: p
    for p in [
        Platform("Terra", "MODIS", "Terra", date(2000, 11, 1), 10.5, 22.5),
        Platform("Aqua", "MODIS", "Aqua", date(2002, 7, 4), 13.5, 1.5),
        # FIRMS FAQ: "Delivery of new Suomi NPP data ceases on Nov. 2, 2026" (13:00 UTC).
        Platform("SNPP", "VIIRS", "N", date(2012, 1, 20), 13.5, 1.5, end=date(2026, 11, 2)),
        # NOAA-20 trails S-NPP by about 50 minutes; NOAA-21 sits between them.
        # Start dates are the FIRMS archive download page's "Temporal Coverage".
        Platform("NOAA20", "VIIRS", "N20", date(2018, 4, 1), 13.5 + 50 / 60, 1.5 + 50 / 60),
        Platform("NOAA21", "VIIRS", "N21", date(2023, 3, 1), 13.5 + 25 / 60, 1.5 + 25 / 60),
    ]
}

# Raw `satellite` spellings (lower-case, trimmed) → platform name.
SATELLITE_ALIASES = {
    "terra": "Terra", "t": "Terra",
    "aqua": "Aqua", "a": "Aqua",
    "n": "SNPP", "npp": "SNPP", "snpp": "SNPP", "suomi npp": "SNPP", "suomi-npp": "SNPP",
    "n20": "NOAA20", "1": "NOAA20", "j1": "NOAA20", "noaa-20": "NOAA20", "noaa20": "NOAA20",
    "n21": "NOAA21", "2": "NOAA21", "j2": "NOAA21", "noaa-21": "NOAA21", "noaa21": "NOAA21",
}


def platform_for(satellite: str) -> Platform | None:
    name = SATELLITE_ALIASES.get(str(satellite).strip().lower())
    return PLATFORMS[name] if name else None
