"""Statistics for /stats (api.md §2.4, PLAN.md §6). Pure functions, no I/O."""

from __future__ import annotations

import math
import statistics


def round_half_up(x: float) -> int:
    return math.floor(x + 0.5)


def r1(x: float | None) -> float | None:
    return None if x is None else round(float(x), 1)


MIN_BASELINE_YEARS = 3  # fewer past years than this can't say what "normal" is


def status_for(z: float | None, value: float, mean: float | None, n: int | None = None) -> str | None:
    """api.md §1.2. With no spread (sd = 0) the value is compared with the mean directly.
    With fewer than MIN_BASELINE_YEARS baseline years there is no status at all."""
    if mean is None or (n is not None and n < MIN_BASELINE_YEARS):
        return None
    if z is None:
        return "normal" if value == mean else ("unusual_high" if value > mean else "below_normal")
    if z >= 2:
        return "unusual_high"
    if z >= 1:
        return "above_normal"
    if z <= -1:
        return "below_normal"
    return "normal"


def compare(value: float, baseline: list[tuple[int, float]]) -> dict:
    """Where `value` sits against the baseline years (the target year is never in `baseline`)."""
    vals = [v for _, v in baseline]
    n = len(vals)
    mean = statistics.fmean(vals) if n else None
    median = statistics.median(vals) if n else None
    sd = statistics.stdev(vals) if n >= 2 else None
    z = (value - mean) / sd if sd else None
    return {
        "n_years": n,
        "mean": r1(mean),
        "median": r1(median),
        "sd": r1(sd),
        "min": r1(min(vals)) if n else None,
        "max": r1(max(vals)) if n else None,
        "values": [{"year": y, "value": r1(v)} for y, v in baseline],
        # % of baseline years strictly lower; rank 1 = highest among baseline + target.
        "percentile": round_half_up(100 * sum(v < value for v in vals) / n) if n else None,
        "rank": 1 + sum(v > value for v in vals),
        "z": r1(z),
        "ratio_to_median": r1(value / median) if median else None,
        "status": status_for(z, value, mean, n),
    }


def sen_slope(years: list[int], values: list[float]) -> float | None:
    slopes = [(values[j] - values[i]) / (years[j] - years[i])
              for i in range(len(years)) for j in range(i + 1, len(years)) if years[j] != years[i]]
    return statistics.median(slopes) if slopes else None


def mann_kendall_p(values: list[float]) -> float | None:
    """Two-sided p-value of the Mann-Kendall trend test (normal approximation, tie-corrected)."""
    n = len(values)
    if n < 3:
        return None
    s = sum((values[j] > values[i]) - (values[j] < values[i]) for i in range(n) for j in range(i + 1, n))
    ties = {}
    for v in values:
        ties[v] = ties.get(v, 0) + 1
    var = (n * (n - 1) * (2 * n + 5) - sum(t * (t - 1) * (2 * t + 5) for t in ties.values())) / 18
    if var <= 0:
        return 1.0
    z = (s - 1) / math.sqrt(var) if s > 0 else (s + 1) / math.sqrt(var) if s < 0 else 0.0
    return 2 * (1 - 0.5 * (1 + math.erf(abs(z) / math.sqrt(2))))


def trend(annual: list[tuple[int, float]]) -> dict | None:
    if len(annual) < 3:
        return None
    years, values = [y for y, _ in annual], [v for _, v in annual]
    p = mann_kendall_p(values)
    return {"sen_slope_per_year": r1(sen_slope(years, values)),
            "p_value": None if p is None else round(p, 3), "series": "annual_totals"}
