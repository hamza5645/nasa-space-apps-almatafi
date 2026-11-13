"""H3: does the harmonization work? (PLAN.md §5.6, data-products.md §4)

- Leave-one-year-out on the Aqua → S-NPP overlap, for every model, scored on 10° tile × month
  totals (day + night): what an area calendar shows. The best R² picks the model.
- Break test at 2012: annual totals of the raw join (MODIS before, S-NPP after) vs the harmonized
  series: mean after ÷ mean before, and a Pettitt change-point test.
- On mock data, the same jump measured against the generator's true fires, per region.
- Plots and a short report in data/validation/.
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
import pandas as pd

from almatafi.harmonize.align import Aligned, overlap_pairs
from almatafi.harmonize.models import MODELS, loyo, scores, tile_of

SCATTER_MAX = 2000
BREAK_YEAR = 2012
# Placebo break years: if the harmonized series "jumps" as much at these as at 2012, the 2012
# number means nothing. Each keeps at least 4 years on each side inside its own era.
PLACEBO_YEARS = (2005, 2007, 2017, 2020)


def _tile(df: pd.DataFrame) -> np.ndarray:
    return tile_of(df["cell_id"])  # from the cell, so M3's climatology-only rows count too


def _block_1deg(df: pd.DataFrame) -> np.ndarray:
    c = df["cell_id"].to_numpy(dtype=np.int64)
    return (c // 3600 // 10) * 360 + (c % 3600) // 10


def cross_validate(aligned: Aligned, metric: str = "detections") -> dict:
    """LOYO for every model on the Aqua → S-NPP bridge, scored on tile × month totals (what an
    area calendar shows) and on 1° × month totals (a small area, where zero cells matter)."""
    pairs = overlap_pairs(aligned, metric, "aqua_to_snpp")
    out = {}
    for model in MODELS:
        cv = loyo(pairs, model)
        agg = cv.assign(tile=_tile(cv)).groupby(["tile", "year", "month"])[["x", "y", "pred"]].sum()
        small = cv.assign(block=_block_1deg(cv)).groupby(["block", "year", "month"])[["y", "pred"]].sum()
        out[model] = {"scores": scores(agg["y"], agg["pred"]), "tile_months": agg,
                      "scores_1deg": scores(small["y"], small["pred"])}
    return out


def choose_model(cv: dict) -> str:
    """Best R²; on a tie the simpler model (M0 before M1 before M2)."""
    def r2(m):
        v = cv[m]["scores"]["r2"]
        return -math.inf if v is None else v  # an R² of exactly 0 still beats a missing one
    return max(MODELS, key=lambda m: (r2(m), -MODELS.index(m)))


def pettitt_p(values) -> float | None:
    """Approximate p-value of the Pettitt change-point test (small p = a break somewhere)."""
    x = np.asarray(values, float)
    n = x.size
    if n < 4:
        return None
    sign = np.sign(x[None, :] - x[:, None])
    u = [sign[: t + 1, t + 1:].sum() for t in range(n - 1)]
    k = np.max(np.abs(u))
    return round(float(min(1.0, 2 * math.exp(-6 * k**2 / (n**3 + n**2)))), 4)


def annual_series(grid: pd.DataFrame, harmonized: pd.DataFrame, last_year: int) -> pd.DataFrame:
    """Annual totals over all cells: the raw join a naive user would make, and the harmonized one.
    The raw side is what the app's raw MODIS view shows: Aqua from July 2002, Terra before (as in
    align.py and the backend). Adding Terra and Aqua would double 2002–2011 and hide part of the
    2012 jump."""
    g = grid[grid["year"].between(2001, last_year)]
    from almatafi.harmonize.align import AQUA_FIRST

    aqua = AQUA_FIRST[0] * 12 + AQUA_FIRST[1] - 1
    ym = g["year"] * 12 + g["month"] - 1
    modis = g[(g["year"] < BREAK_YEAR)
              & (((ym >= aqua) & (g["platform"] == "Aqua")) | ((ym < aqua) & (g["platform"] == "Terra")))]
    snpp = g[(g["year"] >= BREAK_YEAR) & (g["platform"] == "SNPP")]
    raw = pd.concat([modis, snpp]).groupby("year")["detections"].sum()
    harm = harmonized[harmonized["year"].between(2001, last_year)].groupby("year")["value"].sum()
    years = range(2001, last_year + 1)
    return pd.DataFrame({"raw": raw.reindex(years, fill_value=0), "harmonized": harm.reindex(years, fill_value=0)})


def _jump(series: pd.Series, by: pd.Series | None = None) -> float | None:
    s = series / by if by is not None else series
    before, after = s[s.index < BREAK_YEAR].mean(), s[s.index > BREAK_YEAR].mean()
    return None if not before or np.isnan(before) or np.isnan(after) else round(float(after / before), 3)


def placebo_breaks(series: pd.Series) -> dict:
    """The after ÷ before ratio at fake break years, each inside one sensor era (2001–2011 or
    2013 on), so a real 2012 step can't leak into them. A placebo near 1 next to a 2012 ratio
    near 1 means 2012 looks like any other year; a 2012 step would stand out."""
    out = {}
    for year in PLACEBO_YEARS:
        era = series[series.index < BREAK_YEAR] if year < BREAK_YEAR else series[series.index > BREAK_YEAR]
        before, after = era[era.index < year], era[era.index > year]
        if len(before) >= 4 and len(after) >= 4 and before.mean():
            out[str(year)] = round(float(after.mean() / before.mean()), 3)
    return out


def season_check(harmonized: pd.DataFrame, last_year: int) -> dict:
    """Does the fire season keep its shape across the switch? Mean share of each calendar
    month in the year, MODIS era (2003–2011) vs VIIRS era (2013–last full year)."""
    h = harmonized[harmonized["year"].between(2003, last_year) & (harmonized["year"] != BREAK_YEAR)]
    monthly = h.groupby(["year", "month"])["value"].sum().unstack(fill_value=0.0)
    share = monthly.div(monthly.sum(axis=1).replace(0, np.nan), axis=0)
    before, after = share[share.index < BREAK_YEAR].mean(), share[share.index > BREAK_YEAR].mean()
    if before.isna().all() or after.isna().all():
        return {}
    return {"corr_month_shares": round(float(np.corrcoef(before.fillna(0), after.fillna(0))[0, 1]), 3),
            "peak_month_before": int(before.idxmax()), "peak_month_after": int(after.idxmax())}


def truth_check(grid: pd.DataFrame, harmonized: pd.DataFrame, truth_dir: Path, last_year: int) -> dict | None:
    """Mock only: per region, the jump at 2012 relative to the true fires (1.0 = no break)."""
    manifest_path, monthly_path = truth_dir.parent / "manifest.json", truth_dir / "monthly.csv"
    if not (manifest_path.exists() and monthly_path.exists()):
        return None
    regions = json.loads(manifest_path.read_text())["regions"]
    truth = pd.read_csv(monthly_path)
    out = []
    for rid, info in regions.items():
        w, s, e, n = info["bbox"]

        def inside(df):
            r, c = df["cell_id"] // 3600, df["cell_id"] % 3600
            return (((2 * r + 1 - 1800) / 20).between(s - 0.5, n + 0.5)
                    & ((2 * c + 1 - 3600) / 20).between(w - 0.5, e + 0.5))

        series = annual_series(grid[inside(grid)], harmonized[inside(harmonized)], last_year)
        t = truth[truth["region"] == rid].groupby("year")["fire_days"].sum().reindex(series.index)
        series = series[series.index >= 2003]  # Aqua-era onwards; 2001-02 is Terra-only
        t = t.reindex(series.index)
        out.append({
            "region": rid,
            "raw_jump_vs_truth": _jump(series["raw"], t),
            "harmonized_jump_vs_truth": _jump(series["harmonized"], t),
            "corr_harmonized_truth": round(float(np.corrcoef(series["harmonized"], t)[0, 1]), 3),
        })
    return {"metric": "annual totals ÷ true fire-days; jump = mean after 2012 ÷ mean before (1.0 = no break)",
            "regions": out}


def validation(aligned: Aligned, cv: dict, model: str, grid: pd.DataFrame, harmonized: pd.DataFrame,
               data_version: str, truth_dir: Path | None = None) -> dict:
    last_year = int(aligned.status["year"].max()) - 1  # last complete year
    pairs = overlap_pairs(aligned, "detections", "aqua_to_snpp")
    series = annual_series(grid, harmonized, last_year)
    tm = cv[model]["tile_months"]
    sample = tm[["x", "y"]].sample(min(SCATTER_MAX, len(tm)), random_state=0) if len(tm) else tm
    converted = harmonized[harmonized["model"].notna() & (harmonized["stratum_id"] != "climatology")]
    fd = cross_validate(aligned, "fire_days")[model]["scores"]
    first, last = pairs["ym"].min(), pairs["ym"].max()
    return {
        "data_version": data_version,
        "metric": "detections",
        "model": model,
        "overlap_period": [f"{first // 12}-{first % 12 + 1:02d}", f"{last // 12}-{last % 12 + 1:02d}"],
        "cross_validation": "leave-one-year-out",
        "overall": cv[model]["scores"],
        "by_model": [{"model": m, **{k: cv[m]["scores"][k] for k in ("r2", "bias", "mae", "rmse")},
                      "r2_1deg": cv[m]["scores_1deg"]["r2"]} for m in MODELS],
        "break_test": {
            "raw_ratio_after_vs_before_2012": _jump(series["raw"]),
            "harmonized_ratio_after_vs_before_2012": _jump(series["harmonized"]),
            "pettitt_p_raw": pettitt_p(series["raw"]),
            "pettitt_p_harmonized": pettitt_p(series["harmonized"]),
            # Not in data-products.md 1.0 (X14): fake break years and the season's shape.
            "placebo_ratios_harmonized": placebo_breaks(series["harmonized"]),
        },
        "season_check": season_check(harmonized, last_year),
        "series": {"years": series.index.tolist(), "raw": [int(v) for v in series["raw"]],
                   "harmonized": [round(float(v), 1) for v in series["harmonized"]]},
        "scatter_sample": [[int(a), int(b)] for a, b in zip(sample["x"], sample["y"])],
        "strata": {"total": int(converted["stratum_id"].nunique()),
                   "fallback_used": int(converted.loc[~converted["stratum_id"].str.match(r"^t\d+-m\d\d$"),
                                                      "stratum_id"].nunique())},
        # Not in data-products.md 1.0 (additions for 1.1):
        "unit_of_scoring": "10° tile × month totals, day + night",
        "by_metric": {"fire_days": fd},
        "mock_truth": truth_check(grid, harmonized, truth_dir, last_year) if truth_dir else None,
    }


def plots(v: dict, cv: dict, out: Path) -> list[str]:
    """PNG charts for the method page and the pitch. Skipped if matplotlib isn't installed."""
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
    except ImportError:
        return []
    out.mkdir(parents=True, exist_ok=True)
    written = []

    fig, ax = plt.subplots(figsize=(8, 4))
    years = v["series"]["years"]
    ax.plot(years, v["series"]["raw"], label="raw join (MODIS → VIIRS in 2012)", color="#999", lw=2)
    ax.plot(years, v["series"]["harmonized"], label="harmonized (VIIRS S-NPP equivalent)", color="#d94801", lw=2)
    ax.axvline(BREAK_YEAR, color="#333", ls=":", lw=1)
    ax.set_ylabel("detections per year")
    ax.set_title("Annual totals: the 2012 sensor switch")
    ax.legend(frameon=False)
    written.append(_save(fig, out / "series.png"))

    tm = cv[v["model"]]["tile_months"]
    fig, ax = plt.subplots(figsize=(5, 5))
    ax.scatter(tm["x"] + 1, tm["y"] + 1, s=4, alpha=0.3, color="#555", label="observed (Aqua vs S-NPP)")
    ax.scatter(tm["x"] + 1, tm["pred"] + 1, s=4, alpha=0.3, color="#d94801", label=f"{v['model']} prediction (held-out year)")
    ax.set_xscale("log")
    ax.set_yscale("log")
    ax.set_xlabel("MODIS Aqua detections + 1 (tile × month)")
    ax.set_ylabel("VIIRS S-NPP detections + 1")
    ax.legend(frameon=False, fontsize=8)
    written.append(_save(fig, out / "scatter.png"))

    fig, ax = plt.subplots(figsize=(5, 3))
    r2 = [m["r2"] or 0 for m in v["by_model"]]
    ax.bar([m["model"] for m in v["by_model"]], r2, color=["#d94801" if m["model"] == v["model"] else "#bbb"
                                                          for m in v["by_model"]])
    ax.set_ylim(min(r2) - 0.05 if r2 else 0, 1)
    ax.set_ylabel("R², leave-one-year-out")
    ax.set_title("Model comparison")
    written.append(_save(fig, out / "models.png"))

    res = tm.reset_index().assign(res=lambda d: d["pred"] - d["y"]).groupby("tile")["res"].mean()
    tiles = res.index.astype(int)
    lat = (tiles // 36) * 10 - 90 + 5
    lon = (tiles % 36) * 10 - 180 + 5
    fig, ax = plt.subplots(figsize=(8, 4))
    lim = float(np.abs(res).max()) or 1.0
    sc = ax.scatter(lon, lat, c=res, cmap="RdBu_r", vmin=-lim, vmax=lim, s=120, marker="s")
    ax.set_xlim(-180, 180)
    ax.set_ylim(-90, 90)
    ax.set_title("Mean residual per 10° tile (prediction − observed)")
    fig.colorbar(sc, ax=ax, label="detections per month")
    written.append(_save(fig, out / "residual_map.png"))
    return written


def _save(fig, path: Path) -> str:
    fig.tight_layout()
    fig.savefig(path, dpi=120)
    import matplotlib.pyplot as plt
    plt.close(fig)
    return str(path)


def report_md(v: dict) -> str:
    """A short Markdown summary; R6 turns the real-data version into docs/validation.md."""
    o, b = v["overall"], v["break_test"]
    lines = [
        f"# Validation · {v['data_version']}",
        "",
        f"Model **{v['model']}**, leave-one-year-out on the Aqua → S-NPP overlap "
        f"{v['overlap_period'][0]} … {v['overlap_period'][1]}, scored on {v['unit_of_scoring']}.",
        "",
        "| Model | R² (tile) | R² (1°) | Bias | MAE | RMSE |",
        "|---|---|---|---|---|---|",
        *[f"| {m['model']} | {m['r2']} | {m.get('r2_1deg')} | {m['bias']} | {m['mae']} | {m['rmse']} |"
          for m in v["by_model"]],
        "",
        f"Chosen model: n = {o['n']} tile-months, R² = {o['r2']}.",
        "",
        "## Break at 2012",
        "",
        "| Series | Mean after ÷ mean before | Pettitt p |",
        "|---|---|---|",
        f"| Raw join | {b['raw_ratio_after_vs_before_2012']} | {b['pettitt_p_raw']} |",
        f"| Harmonized | {b['harmonized_ratio_after_vs_before_2012']} | {b['pettitt_p_harmonized']} |",
        "",
        f"Placebo break years (harmonized, after ÷ before): {b.get('placebo_ratios_harmonized')}.",
        f"Season shape, MODIS era vs VIIRS era: {v.get('season_check')}.",
        "",
        "![Annual series](series.png)",
        "",
    ]
    if v.get("mock_truth"):
        lines += ["## Against the mock's true fires", "",
                  "| Region | Raw jump | Harmonized jump | corr(harmonized, truth) |", "|---|---|---|---|",
                  *[f"| {r['region']} | {r['raw_jump_vs_truth']} | {r['harmonized_jump_vs_truth']} | "
                    f"{r['corr_harmonized_truth']} |" for r in v["mock_truth"]["regions"]], ""]
    lines += ["![Scatter](scatter.png) ![Models](models.png)", "", "![Residuals](residual_map.png)", ""]
    return "\n".join(lines)


def write(v: dict, cv: dict, out: Path) -> list[str]:
    out.mkdir(parents=True, exist_ok=True)
    (out / "validation.json").write_text(json.dumps(v, indent=2) + "\n")
    (out / "validation.md").write_text(report_md(v))
    return [str(out / "validation.json"), str(out / "validation.md"), *plots(v, cv, out)]
