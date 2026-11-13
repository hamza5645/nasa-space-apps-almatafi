"""Checks on a generated mock: do the planted demo events stand out?

The planted multipliers are tuned for the default seed. Another seed can bury an event
in the yearly noise (the Nile Delta October 2026 event drops below z = 2 for some seeds),
so the CLI runs this check and warns instead of silently losing the demo story.
"""

from __future__ import annotations

import calendar
from datetime import date

import pandas as pd

from almatafi.mock.generate import OUTAGES
from almatafi.mock.regions import REGIONS
from almatafi.platforms import PLATFORMS

Z_MIN = 2.0  # "Unusual, well above normal" (PLAN.md §6)


def _full_month(y: int, m: int, end: date) -> bool:
    """S-NPP observed the whole month: after its start, before `end`, no outage day in it."""
    first, last = date(y, m, 1), date(y, m, calendar.monthrange(y, m)[1])
    if first < PLATFORMS["SNPP"].start or last > end:
        return False
    return not any(a <= last and b >= first for a, b in OUTAGES.get("SNPP", []))


def planted_events(result: dict, end: date) -> list[dict]:
    """z-score of each planted (year, month) against the same month in other full S-NPP
    years, from type-0 S-NPP detections near the region (bbox ± 0.5°)."""
    v = result["VIIRS"]
    out = []
    for rid in sorted(set(result["events"]["region"])):
        region = REGIONS[rid]
        w, s, e, n = region.bbox
        near = (v["longitude"].between(w - 0.5, e + 0.5) & v["latitude"].between(s - 0.5, n + 0.5)
                & (v["satellite"] == "N") & (v["type"] == 0))
        d = v[near]
        for (y, m) in sorted(region.planted):
            if not _full_month(y, m, end):
                continue
            years = [yy for yy in range(PLATFORMS["SNPP"].start.year, end.year + 1)
                     if yy != y and _full_month(yy, m, end)]
            sel = d[d["acq_date"].str[5:7].astype(int) == m]
            counts = sel.groupby(sel["acq_date"].str[:4].astype(int)).size()
            base = pd.Series([int(counts.get(yy, 0)) for yy in years], dtype=float)
            count = int(counts.get(y, 0))
            sd = base.std()
            z = (count - base.mean()) / sd if len(base) >= 3 and sd > 0 else float("nan")
            out.append({"region": rid, "month": f"{y}-{m:02d}", "count": count,
                        "baseline_mean": round(float(base.mean()), 1), "z": round(float(z), 2),
                        "ok": bool(z >= Z_MIN)})
    return out
