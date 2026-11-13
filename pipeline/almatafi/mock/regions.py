"""Mock regions. Numbers are plausible, not measured: they only need to give each
region a different fire regime so MODIS and VIIRS relate differently per stratum."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class Region:
    id: str
    name: str
    bbox: tuple[float, float, float, float]          # west, south, east, north
    fires_per_year: float                            # true fires started, before trend and noise
    season: tuple[float, ...]                        # relative weight per month, Jan..Dec
    frp_median: float                                # MW, peak FRP of a typical fire
    frp_sigma: float                                 # spread of log peak FRP
    mean_days: float                                 # mean burning days per fire
    # Chance a burning fire is active at each overpass group: Terra day, afternoon, Terra night, late night.
    active: tuple[float, float, float, float]
    cloud: tuple[float, float]                       # cloud chance in peak fire month, in the quietest month
    trend: float = 0.0                               # log change per year, centred on 2012
    land: tuple[tuple[float, float], ...] | None = None  # (lon, lat) polygon; fires only inside
    hotspots: int = 8                                # number of fire clusters
    static_sources: int = 0                          # always-on industrial sources (FIRMS type 2)
    planted: dict[tuple[int, int], float] = field(default_factory=dict)  # (year, month) → fire multiplier


REGIONS = {
    r.id: r
    for r in [
        Region(
            "nile-delta", "Nile Delta", (29.9, 30.0, 32.3, 31.6),
            fires_per_year=2200,
            # Wheat residue in May–June, rice straw from September to November.
            season=(0.2, 0.2, 0.3, 0.5, 1.0, 1.2, 0.8, 0.6, 1.5, 5.0, 5.5, 1.5),
            frp_median=3.5, frp_sigma=0.8, mean_days=1.2,
            active=(0.25, 0.45, 0.05, 0.03), cloud=(0.03, 0.15), trend=-0.02,
            land=((31.24, 30.05), (30.0, 31.1), (30.4, 31.45), (31.0, 31.55),
                  (31.8, 31.48), (32.25, 31.25), (31.6, 30.5)),
            hotspots=10, static_sources=2,
            planted={(2026, 10): 1.8},
        ),
        Region(
            "rio-negro", "Río Negro", (-71.8, -41.8, -68.0, -39.5),
            fires_per_year=260,
            season=(5.0, 4.0, 3.0, 1.0, 0.3, 0.2, 0.2, 0.3, 0.5, 1.0, 2.0, 4.0),
            frp_median=25, frp_sigma=1.2, mean_days=3.0,
            active=(0.8, 0.9, 0.6, 0.5), cloud=(0.15, 0.55), trend=0.02,
            hotspots=6,
            # CONAE's case: an unusual winter outbreak in July 2026.
            planted={(2026, 7): 15.0},
        ),
        Region(
            "amazon", "Amazon (Rondônia)", (-64.0, -11.0, -61.0, -9.0),
            fires_per_year=2600,
            season=(0.1, 0.1, 0.1, 0.2, 0.4, 1.0, 3.0, 8.0, 9.0, 4.0, 1.0, 0.3),
            frp_median=18, frp_sigma=1.1, mean_days=2.0,
            active=(0.6, 0.8, 0.3, 0.2), cloud=(0.1, 0.6), trend=-0.01,
            hotspots=12,
        ),
        Region(
            "central-africa", "Central African savanna", (22.0, 5.0, 25.0, 7.0),
            fires_per_year=3200,
            season=(8.0, 5.0, 2.0, 0.5, 0.1, 0.05, 0.05, 0.05, 0.1, 0.5, 3.0, 9.0),
            frp_median=12, frp_sigma=1.0, mean_days=1.5,
            active=(0.5, 0.7, 0.2, 0.1), cloud=(0.05, 0.6), trend=-0.015,
            hotspots=15,
        ),
        Region(
            "northern-australia", "Northern Australia", (131.0, -15.0, 134.0, -13.0),
            fires_per_year=1400,
            season=(0.2, 0.1, 0.1, 0.5, 2.0, 4.0, 5.0, 6.0, 6.0, 4.0, 1.0, 0.4),
            frp_median=20, frp_sigma=1.1, mean_days=3.0,
            active=(0.7, 0.85, 0.4, 0.3), cloud=(0.03, 0.5),
            hotspots=10,
        ),
        Region(
            "california", "Northern California", (-122.5, 38.5, -120.5, 40.5),
            fires_per_year=120,
            season=(0.2, 0.2, 0.3, 0.5, 1.0, 2.0, 4.0, 5.0, 4.0, 3.0, 1.0, 0.3),
            frp_median=40, frp_sigma=1.4, mean_days=6.0,
            active=(0.85, 0.95, 0.7, 0.6), cloud=(0.05, 0.4), trend=0.04,
            hotspots=6,
        ),
    ]
}
