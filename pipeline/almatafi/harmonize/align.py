"""H1: line the platforms up per cell-month, decide which platform stands for each month,
and attach the calibration strata (PLAN.md §5.3–5.4, grid.md §6).

The target is VIIRS S-NPP. Aqua and S-NPP pass at the same time (13:30 / 01:30), so Aqua → S-NPP
is the main bridge; Terra (10:30 / 22:30) is first mapped to Aqua; NOAA-20, then NOAA-21, fill
S-NPP gaps, and carry the record on their own since S-NPP stopped (FIRMS: Nov 2, 2026).
Day and night are kept apart for `detections`. `fire_days` uses each platform's best pass
(fire days can't be added across passes without counting a day twice).
"""

from __future__ import annotations

import calendar
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd

from almatafi import cells
from almatafi.platforms import PLATFORMS as _PLATFORM_INFO

PLATFORMS = ["Terra", "Aqua", "SNPP", "NOAA20", "NOAA21"]
FULL = 0.9                # share of a month's days a platform must observe to count as complete
# A day without any hotspot can be a quiet day, not a gap. NOAA-20 fills an S-NPP month only
# when it observed at least this much more of the month: that is a real S-NPP outage.
GAP_MARGIN = 0.15
MIN_PAIRS = 30            # grid.md §6: fewer overlap cell-months than this → fall back
FIRST_MONTH = (2001, 1)   # harmonized product starts here (data-products.md §3)
SNPP_FIRST = (2012, 2)
# The first month S-NPP doesn't cover in full (FIRMS: delivery ended Nov 2, 2026). From then
# on NOAA-20 (else NOAA-21) stands for the month whenever it has data.
_snpp_end = _PLATFORM_INFO["SNPP"].end
SNPP_END = (9999, 12) if _snpp_end is None else (_snpp_end.year, _snpp_end.month)
AQUA_FIRST = (2002, 7)
LEVELS = ["s_tile_month", "s_tile_all", "s_band_month", "s_global_month", "s_global_all"]

# Conversion steps: (source platform, target platform, first and last month of the overlap
# used for fitting). The windows follow the literature (X14, docs/method.md §4):
# - Aqua → S-NPP stops at 2022: Aqua's orbit drifts after its last manoeuvre (2021), and FIRMS
#   says the drift's effect on fire products is still under investigation (Giglio, May 2025).
# - Terra → Aqua uses 2003–2011, Aqua's first full years before VIIRS, as GFED5 does for the
#   Terra-only months.
STEPS = {
    "aqua_to_snpp": ("Aqua", "SNPP", SNPP_FIRST, (2022, 12)),
    "terra_to_aqua": ("Terra", "Aqua", (2003, 1), (2011, 12)),
    "noaa20_to_snpp": ("NOAA20", "SNPP", (2018, 4), (2026, 10)),
    "noaa21_to_snpp": ("NOAA21", "SNPP", (2023, 3), (2026, 10)),
}
# VIIRS → VIIRS steps are the same instrument, so they're a plain ratio whatever model wins.
VIIRS_STEPS = ("noaa20_to_snpp", "noaa21_to_snpp")


def ym_key(year, month):
    return np.asarray(year, dtype=np.int64) * 12 + np.asarray(month, dtype=np.int64) - 1


@dataclass
class Aligned:
    status: pd.DataFrame            # per month: fraction of days each platform observed + origin
    wide: dict[str, pd.DataFrame]   # metric → cell-month rows, one column per platform


def load(grid_dir: Path) -> tuple[pd.DataFrame, pd.DataFrame]:
    grid = pd.read_parquet(grid_dir / "grid_monthly.parquet")
    coverage = pd.read_parquet(grid_dir / "coverage.parquet")
    return grid, coverage


def month_status(coverage: pd.DataFrame) -> pd.DataFrame:
    """Per month: share of days each platform observed, and which platform stands for the month.

    The share is over the whole month, except the last month with data, where it is over the
    days elapsed so far (so a partial current month isn't mistaken for an outage).
    """
    days = coverage.pivot_table(index=["year", "month"], columns="platform", values="observed_days",
                                aggfunc="sum", fill_value=0)
    days = days.reindex(columns=PLATFORMS, fill_value=0)
    first, last = ym_key(*FIRST_MONTH), int(ym_key(days.index.get_level_values(0), days.index.get_level_values(1)).max())
    idx = pd.MultiIndex.from_tuples([(k // 12, k % 12 + 1) for k in range(int(first), last + 1)],
                                    names=["year", "month"])
    days = days.reindex(idx, fill_value=0)
    denom = np.array([calendar.monthrange(y, m)[1] for y, m in idx], dtype=float)
    denom[-1] = max(days.iloc[-1].max(), 1)
    frac = days.div(denom, axis=0).clip(upper=1.0)
    frac.columns = [f"frac_{c}" for c in frac.columns]
    status = frac.reset_index()
    status["ym"] = ym_key(status["year"], status["month"])
    status["origin"] = [_origin(r) for r in status.itertuples(index=False)]
    return status


def _origin(r) -> str | None:
    ym = (r.year, r.month)
    if ym >= SNPP_FIRST:
        # An S-NPP gap (an outage, or S-NPP's end) is filled by NOAA-20, else NOAA-21.
        for name, col in (("filled_noaa20", r.frac_NOAA20), ("filled_noaa21", r.frac_NOAA21)):
            if col >= FULL and col - r.frac_SNPP >= GAP_MARGIN:
                return name
        if ym >= SNPP_END:
            # S-NPP has stopped: a NOAA satellite with data stands for the month even when the
            # build's coverage makes it look partial (quiet days count as gaps on small areas, X21),
            # instead of S-NPP's last 2 days or a converted Aqua month.
            for name, col in (("filled_noaa20", r.frac_NOAA20), ("filled_noaa21", r.frac_NOAA21)):
                if col > 0 and col >= r.frac_SNPP:
                    return name
        if r.frac_SNPP > 0:
            return "observed_snpp"  # as observed; quiet days can't be told from short gaps
    if ym >= AQUA_FIRST and r.frac_Aqua > 0:
        return "converted_aqua"
    if r.frac_Terra > 0:
        return "converted_terra"
    return None


def wide(grid: pd.DataFrame, metric: str) -> pd.DataFrame:
    """Cell-month rows with one column per platform (0 where that platform saw nothing), and
    `<platform>_big`: the part of it MODIS could have seen (grid.py's FRP floor).

    `detections` keeps day (D) and night (N) apart; `fire_days` uses each platform's best pass
    and a single `daynight` of "A" (all).
    """
    g = grid[grid["year"] * 12 + grid["month"] - 1 >= ym_key(*FIRST_MONTH)]
    big = f"{metric}_big"
    if big not in g.columns:  # a grid from before X14: treat every detection as visible to MODIS
        g = g.assign(**{big: g[metric]})
    if metric == "detections":
        out = g.pivot_table(index=["cell_id", "year", "month", "daynight"], columns="platform",
                            values=[metric, big], aggfunc="sum", fill_value=0)
    elif metric == "fire_days":
        out = g.pivot_table(index=["cell_id", "year", "month"], columns="platform",
                            values=[metric, big], aggfunc="max", fill_value=0)
        out["daynight"] = "A"
        out = out.set_index("daynight", append=True)
    else:
        raise ValueError(f"unknown metric {metric!r}")
    out.columns = [p if v == metric else f"{p}_big" for v, p in out.columns]
    cols = PLATFORMS + [f"{p}_big" for p in PLATFORMS]
    out = out.reindex(columns=cols, fill_value=0).astype(float).reset_index()
    out.columns.name = None
    out["ym"] = ym_key(out["year"], out["month"])
    return add_strata(out)


def add_strata(df: pd.DataFrame) -> pd.DataFrame:
    """Stratum ids at every fallback level (grid.md §6), from the cell's row and column."""
    row = df["cell_id"].to_numpy() // cells.N_COLS
    col = df["cell_id"].to_numpy() % cells.N_COLS
    tile = (row // cells.TILE_CELLS) * cells.TILE_COLS + col // cells.TILE_CELLS
    band = row // cells.TILE_CELLS
    mm = df["month"].map("{:02d}".format)
    t = pd.Series(tile, index=df.index).astype(str)
    df = df.copy()
    df["s_tile_month"] = "t" + t + "-m" + mm
    df["s_tile_all"] = "t" + t + "-mall"
    df["s_band_month"] = "b" + pd.Series(band, index=df.index).astype(str) + "-m" + mm
    df["s_global_month"] = "g-m" + mm
    df["s_global_all"] = "g-mall"  # last resort, not in grid.md 1.0
    return df


def align(grid: pd.DataFrame, coverage: pd.DataFrame) -> Aligned:
    return Aligned(month_status(coverage), {m: wide(grid, m) for m in ("detections", "fire_days")})


def overlap_pairs(aligned: Aligned, metric: str, step: str) -> pd.DataFrame:
    """Cell-months where both platforms of a step were observing, inside the step's fitting
    window: x = source, y = target, y_big = the part of y MODIS could have seen.

    The target must be fully observed (≥ 90% of days) so a gap doesn't look like "no fire";
    the source must have observed at all. Rows where both are 0 don't exist in the grid.
    `attrs["overlap_months"]` lists every (year, month) of the overlap, so per-year averages
    can count the years that had nothing in them.
    """
    src, dst, first, last = STEPS[step]
    st = aligned.status
    ok = st[(st["ym"] >= ym_key(*first)) & (st["ym"] <= ym_key(*last))
            & (st[f"frac_{src}"] > 0) & (st[f"frac_{dst}"] >= FULL)]
    df = aligned.wide[metric]
    df = df[df["ym"].isin(ok["ym"]) & ((df[src] > 0) | (df[dst] > 0))]
    out = df[["cell_id", "year", "month", "ym", "daynight", *LEVELS]].copy()
    out["x"], out["y"], out["y_big"] = df[src].to_numpy(), df[dst].to_numpy(), df[f"{dst}_big"].to_numpy()
    out = out.reset_index(drop=True)
    out.attrs["overlap_months"] = [(int(y), int(m)) for y, m in zip(ok["year"], ok["month"])]
    return out


def stratum_sizes(pairs: pd.DataFrame) -> dict[str, int]:
    """Overlap cell-months per stratum id, at every level, per day/night pass."""
    sizes = {}
    for level in LEVELS:
        for (dn, sid), n in pairs.groupby(["daynight", level]).size().items():
            sizes[(dn, sid)] = int(n)
    return sizes


def assign_strata(rows: pd.DataFrame, available: set) -> pd.Series:
    """For each row, the first stratum in its fallback chain that has a model for its pass."""
    chosen = pd.Series(None, index=rows.index, dtype=object)
    for level in LEVELS:
        todo = chosen.isna()
        if not todo.any():
            break
        keys = list(zip(rows.loc[todo, "daynight"], rows.loc[todo, level]))
        hit = np.array([k in available for k in keys], dtype=bool)
        chosen.loc[todo[todo].index[hit]] = rows.loc[todo, level].to_numpy()[hit]
    return chosen
