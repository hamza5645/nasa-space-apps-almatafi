"""H2: conversion models fitted per stratum and pass (PLAN.md §5.4).

M0 ratio      y = k·x,                     k = Σy / Σx
M1 log-linear log(1+y) = a + b·log(1+x),   least squares on cell-months with x > 0
M2 quantiles  y = Q_y(F_x(x)),             101 quantiles of x and y on cell-months with x > 0
M3 split      y = k·x + small(c, m) · r,   X14, below

A source that sees nothing (x = 0) can't say where the target saw fire, so M0–M2 give 0
there. M1 and M2 carry a mass factor `s` that makes their totals over the overlap equal the
target's, including the fires only the target saw; M0 has that built in. Either way the
small fires end up spread over cells where MODIS happened to see something, which makes
quiet places noisy before 2012 (a cell-month with one MODIS hotspot becomes k of them, the
one next to it stays at 0).

M3 splits the target in two, at MODIS's FRP detection floor (grid.py):
- the fires MODIS could have seen: `k = Σ y_big / Σ x` per stratum, applied to x;
- the small fires MODIS can't see: each cell's own mean per calendar month over the overlap
  years, `small(c, m)`, scaled by how active that year is in the cell's 10° tile by MODIS,
  `r = (X_tile + α) / (mean X_tile + α)`, clipped to [R_MIN, R_MAX]. α keeps quiet tiles
  from swinging on one or two hotspots.
So small fires land where VIIRS shows they happen, and still follow the year's activity.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from almatafi import cells
from almatafi.harmonize.align import LEVELS, MIN_PAIRS, assign_strata

MODELS = ("M0", "M1", "M2", "M3")
ALPHA = 5.0           # M3: prior count in the activity index
R_MIN, R_MAX = 0.2, 5.0
MIN_POSITIVE = 10  # cell-months with x > 0 needed to fit M1 / M2
N_QUANTILES = 101


def _level_groups(pairs: pd.DataFrame):
    """(daynight, stratum) groups with enough overlap cell-months, at every fallback level."""
    for level in LEVELS:
        df = pairs.assign(stratum=pairs[level])
        size = df.groupby(["daynight", "stratum"])["x"].transform("size")
        yield df[size >= MIN_PAIRS]


def tile_of(cell_id) -> np.ndarray:
    c = np.asarray(cell_id, dtype=np.int64)
    row, col = c // cells.N_COLS, c % cells.N_COLS
    return (row // cells.TILE_CELLS) * cells.TILE_COLS + col // cells.TILE_CELLS


def small_climatology(pairs: pd.DataFrame) -> tuple[pd.Series, pd.Series]:
    """M3's two tables from the overlap: the small-fire mean per (cell, month, daynight), and
    the mean MODIS total per (tile, month, daynight). Means are over every overlap year of
    that calendar month, including the years with nothing in the cell or tile."""
    years = pd.Series([m for _, m in pairs.attrs.get("overlap_months", [])], dtype="int64").value_counts()
    if years.empty:  # pairs without the attrs (hand-made in tests): the years that appear
        years = pairs.groupby("month")["year"].nunique()
    small = (pairs["y"] - pairs["y_big"]).clip(lower=0)
    s = pairs.assign(small=small).groupby(["cell_id", "month", "daynight"])["small"].sum()
    s = s[s > 0]
    s = s / years.reindex(s.index.get_level_values("month")).to_numpy()
    t = pairs.assign(tile=tile_of(pairs["cell_id"])).groupby(["tile", "month", "daynight"])["x"].sum()
    t = t / years.reindex(t.index.get_level_values("month")).to_numpy()
    return s.rename("small"), t.rename("mean_x")


def activity(params: pd.DataFrame, x_tile: pd.Series) -> pd.Series:
    """M3's r per (tile, year, month, daynight), from that month's MODIS totals per tile."""
    mean_x = params.attrs["mean_x"]
    keys = x_tile.index.droplevel("year")
    mean = pd.Series(mean_x.reindex(keys).fillna(0.0).to_numpy(), index=x_tile.index)
    return ((x_tile + ALPHA) / (mean + ALPHA)).clip(R_MIN, R_MAX)


def small_part(params: pd.DataFrame, rows: pd.DataFrame, x_tile: pd.Series) -> np.ndarray:
    """small(c, m) · r for rows with cell_id, year, month, daynight. A tile with no MODIS
    total in `x_tile` that month counts as X = 0."""
    small = params.attrs["small"]
    keys = pd.MultiIndex.from_arrays([rows["cell_id"].to_numpy(), rows["month"].to_numpy(), rows["daynight"].to_numpy()])
    sm = small.reindex(keys).fillna(0.0).to_numpy()
    tile = tile_of(rows["cell_id"])
    tk = pd.MultiIndex.from_arrays([tile, rows["year"].to_numpy(), rows["month"].to_numpy(), rows["daynight"].to_numpy()],
                                   names=["tile", "year", "month", "daynight"])
    xt = x_tile.reindex(tk).fillna(0.0)
    r = activity(params, xt).to_numpy()
    return sm * r


def tile_totals(rows: pd.DataFrame, x_col: str) -> pd.Series:
    return rows.assign(tile=tile_of(rows["cell_id"])).groupby(["tile", "year", "month", "daynight"])[x_col].sum()


def climatology_rows(params: pd.DataFrame, months: list[tuple[int, int]], present: pd.DataFrame) -> pd.DataFrame:
    """Cell-months that have small-fire climatology but aren't in `present` (no platform saw
    anything there that month): M3 still gives them small(c, m) · r. Columns cell_id, year,
    month, daynight."""
    small = params.attrs["small"].reset_index()[["cell_id", "month", "daynight"]]
    if small.empty or not months:
        return pd.DataFrame(columns=["cell_id", "year", "month", "daynight"])
    ym = pd.DataFrame(months, columns=["year", "month"])
    cand = small.merge(ym, on="month")
    have = present[["cell_id", "year", "month", "daynight"]].drop_duplicates()
    cand = cand.merge(have, how="left", indicator=True)
    return cand[cand["_merge"] == "left_only"].drop(columns="_merge").reset_index(drop=True)


def fit(pairs: pd.DataFrame, model: str) -> pd.DataFrame:
    """One row per (daynight, stratum) that could be fitted: model params and n_obs."""
    out = []
    for df in _level_groups(pairs):
        if df.empty:
            continue
        g = df.groupby(["daynight", "stratum"])
        base = pd.DataFrame({"n_obs": g.size(), "sx": g["x"].sum(), "sy": g["y"].sum()})
        if model == "M0":
            p = base[base["sx"] > 0].assign(k=lambda t: t["sy"] / t["sx"])
        elif model == "M3":
            base = base.join(g["y_big"].sum().rename("sy_big"))
            p = base[base["sx"] > 0].assign(k=lambda t: t["sy_big"] / t["sx"])
        else:
            pos = df[df["x"] > 0]
            gp = pos.groupby(["daynight", "stratum"])
            p = base.join(gp.size().rename("n_pos")).fillna({"n_pos": 0})
            p = p[p["n_pos"] >= MIN_POSITIVE]
            if model == "M1":
                lx, ly = np.log1p(pos["x"]), np.log1p(pos["y"])
                s = pd.DataFrame({"lx": lx, "ly": ly, "lxx": lx * lx, "lxy": lx * ly,
                                  "daynight": pos["daynight"], "stratum": pos["stratum"]})
                sums = s.groupby(["daynight", "stratum"]).sum()
                p = p.join(sums)
                n = p["n_pos"]
                den = n * p["lxx"] - p["lx"] ** 2
                p = p[den > 1e-12]
                den = den[den > 1e-12]
                p = p.assign(b=(n * p["lxy"] - p["lx"] * p["ly"]) / den)
                p = p.assign(a=(p["ly"] - p["b"] * p["lx"]) / n)
            else:
                q = np.linspace(0, 1, N_QUANTILES)
                xq, yq = {}, {}
                for key, grp in gp:
                    if key in p.index:
                        xq[key], yq[key] = _quantile_map(grp["x"].to_numpy(), grp["y"].to_numpy(), q)
                p = p.assign(xq=pd.Series(xq), yq=pd.Series(yq))
            # Mass factor: totals over the overlap must match, fires the source missed included.
            pos = df[(df["x"] > 0) & pd.MultiIndex.from_arrays([df["daynight"], df["stratum"]]).isin(p.index)]
            got = pd.Series(predict_raw(p, model, pos), index=pd.MultiIndex.from_arrays(
                [pos["daynight"], pos["stratum"]], names=["daynight", "stratum"])).groupby(level=[0, 1]).sum()
            p = p.join(got.rename("pred_sum"))
            p["s"] = np.where(p["pred_sum"] > 0, p["sy"] / p["pred_sum"], 1.0)
        out.append(p)
    fitted = pd.concat(out) if out else pd.DataFrame()
    fitted = fitted[~fitted.index.duplicated()]
    if model == "M3":
        if len(pairs):
            fitted.attrs["small"], fitted.attrs["mean_x"] = small_climatology(pairs)
        else:  # nothing to learn from: no small fires, every tile at its (zero) mean
            idx = lambda *n: pd.MultiIndex.from_arrays([[]] * len(n), names=list(n))  # noqa: E731
            fitted.attrs["small"] = pd.Series([], index=idx("cell_id", "month", "daynight"), dtype=float, name="small")
            fitted.attrs["mean_x"] = pd.Series([], index=idx("tile", "month", "daynight"), dtype=float, name="mean_x")
    return fitted


def _quantile_map(x: np.ndarray, y: np.ndarray, q: np.ndarray) -> tuple[list[float], list[float]]:
    xq, yq = np.quantile(x, q), np.quantile(y, q)
    # Equal x quantiles (many cell-months with 1 detection) collapse to one knot at their mean y.
    knots = pd.Series(yq).groupby(xq).mean()
    return [round(float(v), 4) for v in knots.index], [round(float(v), 4) for v in knots.to_numpy()]


def predict_raw(params: pd.DataFrame, model: str, rows: pd.DataFrame) -> np.ndarray:
    """Model output before the mass factor, for rows with `daynight`, `stratum` and `x`."""
    x = rows["x"].to_numpy(dtype=float)
    keys = pd.MultiIndex.from_arrays([rows["daynight"], rows["stratum"]])
    p = params.reindex(keys)
    if model in ("M0", "M3"):  # M3's small part is added in predict()
        return p["k"].to_numpy() * x
    if model == "M1":
        out = np.expm1(p["a"].to_numpy() + p["b"].to_numpy() * np.log1p(x))
        return np.where(x > 0, np.maximum(out, 0.0), 0.0)
    out = np.zeros(x.size)
    groups = pd.DataFrame({"d": rows["daynight"].to_numpy(), "s": rows["stratum"].to_numpy()}).groupby(["d", "s"]).indices
    for key, idx in groups.items():
        if key not in params.index:
            continue
        xq, yq = np.asarray(params.at[key, "xq"]), np.asarray(params.at[key, "yq"])
        xi = x[idx]
        # Above the top quantile, keep the top quantile's ratio.
        top = yq[-1] * xi / xq[-1] if xq[-1] > 0 else np.full(xi.size, yq[-1])
        out[idx] = np.where(xi <= 0, 0.0, np.where(xi > xq[-1], top, np.interp(xi, xq, yq)))
    return out


def predict(params: pd.DataFrame, model: str, rows: pd.DataFrame, x_col: str) -> tuple[np.ndarray, pd.Series]:
    """Converted values for rows (with strata columns), and the stratum each row used."""
    available = set(params.index)
    stratum = assign_strata(rows, available)
    ok = stratum.notna().to_numpy()
    out = np.zeros(len(rows))
    if ok.any():
        sub = pd.DataFrame({"daynight": rows["daynight"].to_numpy()[ok], "stratum": stratum.to_numpy()[ok],
                            "x": rows[x_col].to_numpy(dtype=float)[ok]})
        raw = predict_raw(params, model, sub)
        if model in ("M1", "M2"):
            raw = raw * params.reindex(pd.MultiIndex.from_arrays([sub["daynight"], sub["stratum"]]))["s"].to_numpy()
        out[ok] = np.maximum(raw, 0.0)
    if model == "M3" and len(rows):
        out = out + small_part(params, rows, tile_totals(rows, x_col))
    return out, stratum


def loyo(pairs: pd.DataFrame, model: str) -> pd.DataFrame:
    """Leave-one-year-out: each year predicted by a model fitted on all the other years.

    For M3 the held-out year also gets rows for cells that saw nothing that year but have
    small-fire climatology (x = y = 0, pred = small · r), so tile totals count them."""
    parts = []
    overlap = pairs.attrs.get("overlap_months", [])
    for year in sorted(pairs["year"].unique()):
        train, test = pairs[pairs["year"] != year].copy(), pairs[pairs["year"] == year]
        train.attrs = {"overlap_months": [ym for ym in overlap if ym[0] != year]}
        params = fit(train, model)
        pred, stratum = predict(params, model, test, "x") if len(params) else (np.zeros(len(test)), None)
        parts.append(test.assign(pred=pred, stratum_cv=stratum))
        if model == "M3" and len(params):
            months = sorted({ym for ym in overlap if ym[0] == year} or set(zip(test["year"], test["month"])))
            extra = climatology_rows(params, months, test)
            if len(extra):
                extra = extra.assign(x=0.0, y=0.0, y_big=0.0)
                extra["pred"] = small_part(params, extra, tile_totals(test, "x"))
                parts.append(extra)
    return pd.concat(parts, ignore_index=True)


def scores(y: np.ndarray, pred: np.ndarray) -> dict:
    y, pred = np.asarray(y, float), np.asarray(pred, float)
    if y.size == 0:
        return {"r2": None, "bias": None, "mae": None, "rmse": None, "n": 0}
    ss_tot = ((y - y.mean()) ** 2).sum()
    r2 = 1 - ((y - pred) ** 2).sum() / ss_tot if ss_tot > 0 else None
    return {"r2": None if r2 is None else round(float(r2), 4), "bias": round(float((pred - y).mean()), 4),
            "mae": round(float(np.abs(pred - y).mean()), 4),
            "rmse": round(float(np.sqrt(((pred - y) ** 2).mean())), 4), "n": int(y.size)}
