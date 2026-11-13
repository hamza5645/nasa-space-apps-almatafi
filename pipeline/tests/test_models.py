import calendar
import json
from datetime import date

import numpy as np
import pandas as pd
import pyarrow.parquet as pq
import pytest

from almatafi import cells
from almatafi.grid import build as build_grid
from almatafi.harmonize.__main__ import main
from almatafi.harmonize.align import add_strata
from almatafi.harmonize.build import HARMONIZED_SCHEMA, MODELS_SCHEMA, build
from almatafi.harmonize.models import (ALPHA, MODELS, climatology_rows, fit, loyo, predict, scores, small_part,
                                       tile_totals)
from almatafi.ingest import ingest
from almatafi.mock.generate import firms_files, generate, write
from almatafi.mock.regions import REGIONS

CELL = cells.cell_id(30.15, 31.25)


def _pairs(x, y, years=None, cell=CELL, month=10, dn="D", y_big=None):
    df = pd.DataFrame({"cell_id": cell, "month": month, "daynight": dn, "x": np.asarray(x, float),
                       "y": np.asarray(y, float), "year": years if years is not None else 2015})
    df["y_big"] = df["y"] if y_big is None else np.asarray(y_big, float)
    return add_strata(df)


def test_m3_with_nothing_to_learn_from_predicts_zero_not_a_crash():
    empty = _pairs([1], [1]).iloc[0:0]
    params = fit(empty, "M3")
    rows = add_strata(pd.DataFrame({"cell_id": [CELL], "year": [2005], "month": [10], "daynight": ["D"], "x": [3.0]}))
    pred, _ = predict(params, "M3", rows, "x")
    assert pred.tolist() == [0.0]


def test_m3_splits_at_the_floor_and_keeps_small_fires_where_viirs_saw_them():
    """Big fires convert by ratio; small ones come from the cell's own climatology, averaged
    over every overlap year (a year with nothing counts as 0), times the year's activity."""
    years = [2013] * 20 + [2014] * 20
    p = _pairs([2] * 40, [10] * 40, years=years, y_big=[4] * 40)
    p.attrs["overlap_months"] = [(2013, 10), (2014, 10), (2015, 10), (2016, 10)]
    params = fit(p, "M3")
    assert params.loc[("D", "t453-m10"), "k"] == pytest.approx(2.0)   # Σ y_big / Σ x
    # 40 rows × 6 small fires over 4 overlap Octobers.
    assert params.attrs["small"].loc[(CELL, 10, "D")] == pytest.approx(40 * 6 / 4)
    assert params.attrs["mean_x"].loc[(453, 10, "D")] == pytest.approx(80 / 4)
    # A pre-2012 October where MODIS saw nothing anywhere in the tile: no big fires, and the
    # small ones scaled down by the quiet year, but not zero.
    rows = climatology_rows(params, [(2005, 10)], pd.DataFrame(columns=["cell_id", "year", "month", "daynight"]))
    assert len(rows) == 1 and rows.iloc[0]["cell_id"] == CELL
    got = small_part(params, rows, tile_totals(rows.assign(x=0.0), "x"))
    assert got[0] == pytest.approx(60 * ALPHA / (20 + ALPHA))
    # An average year (tile total = its mean) gets exactly the climatology.
    avg = rows.assign(x=20.0)
    assert small_part(params, avg, tile_totals(avg, "x"))[0] == pytest.approx(60)


def test_m0_is_the_ratio_of_totals():
    p = _pairs([1, 2, 0, 5] * 10, [3, 7, 4, 15] * 10)
    params = fit(p, "M0")
    k = params.loc[("D", "t453-m10"), "k"]
    assert k == pytest.approx(29 / 8)
    pred, used = predict(params, "M0", p, "x")
    assert pred.sum() == pytest.approx(p["y"].sum()) and (used == "t453-m10").all()


@pytest.mark.parametrize("model", ["M1", "M2"])
def test_mass_factor_keeps_totals_including_fires_the_source_missed(model):
    rng = np.random.default_rng(1)
    x = rng.poisson(3, 200).astype(float)
    y = 4 * x + rng.poisson(2, 200)          # target also sees fires where x == 0
    p = _pairs(x, y)
    params = fit(p, model)
    pred, _ = predict(params, model, p, "x")
    assert pred.sum() == pytest.approx(y.sum(), rel=1e-6)
    assert (pred[x == 0] == 0).all() and (pred >= 0).all()


def test_m1_recovers_a_power_law():
    x = np.tile(np.arange(1, 41, dtype=float), 3)
    y = np.expm1(0.5 + 1.2 * np.log1p(x))
    params = fit(_pairs(x, y), "M1").iloc[0]
    assert params["b"] == pytest.approx(1.2, abs=1e-9) and params["a"] == pytest.approx(0.5, abs=1e-9)
    assert params["s"] == pytest.approx(1.0, abs=1e-9)


def test_m2_maps_quantiles_and_is_monotone():
    x = np.arange(1, 101, dtype=float)
    params = fit(_pairs(x, x ** 2), "M2")
    probe = _pairs(np.array([0, 1, 50, 100, 200]), np.zeros(5))
    pred, _ = predict(params, "M2", probe, "x")
    assert pred[0] == 0 and np.all(np.diff(pred) > 0)
    assert pred[3] == pytest.approx(10000 * params.iloc[0]["s"], rel=1e-3)
    assert pred[4] == pytest.approx(2 * pred[3], rel=1e-6)  # above the top quantile: same ratio


def test_thin_strata_fall_back():
    # 20 pairs in tile 453 (too few), 40 in a neighbouring tile of the same 10° band.
    thin = _pairs([1] * 20, [2] * 20)
    rich = _pairs([1] * 40, [5] * 40, cell=cells.cell_id(30.15, 41.25))
    params = fit(pd.concat([thin, rich], ignore_index=True), "M0")
    assert ("D", "t453-m10") not in params.index
    _, used = predict(params, "M0", thin, "x")
    assert (used == "b12-m10").all()


def test_loyo_never_sees_the_year_it_predicts():
    years = np.repeat([2013, 2014, 2015], 40)
    y = np.where(years == 2015, 100.0, 2.0)  # 2015 behaves differently
    cv = loyo(_pairs(np.ones(120), y, years=years), "M0")
    assert cv.loc[cv["year"] == 2015, "pred"].eq(2.0).all()
    assert cv.loc[cv["year"] == 2013, "pred"].eq(51.0).all()  # (40·2 + 40·100) / 80


def test_scores():
    s = scores([1, 2, 3, 4], [1, 2, 3, 5])
    assert s == {"r2": round(1 - 1 / 5, 4), "bias": 0.25, "mae": 0.25, "rmse": 0.5, "n": 4}
    assert scores([], [])["n"] == 0


@pytest.fixture(scope="module")
def built(tmp_path_factory):
    root, end = tmp_path_factory.mktemp("h2"), date(2026, 10, 31)
    write(generate(seed=2026, end=end, regions=["rio-negro", "nile-delta"]), root / "raw", seed=2026, end=end, messy_year=None)
    files = firms_files(root / "raw")
    ingest(files, root / "clean", root / "rep", "mock", today=end)
    build_grid(root / "clean", root / "grid", root / "rep")
    report = build(root / "grid", root / "harmonized", root / "rep", model="M1")
    return root, report


def test_product_schema_and_metadata(built):
    root, report = built
    s = pq.read_schema(root / "harmonized" / "harmonized_monthly.parquet")
    assert s.remove_metadata() == HARMONIZED_SCHEMA
    assert s.metadata[b"covered_start"] == b"2001-01" and s.metadata[b"covered_end"] == b"2026-10"
    assert s.metadata[b"model"] == b"M1" and s.metadata[b"data_version"] == b"mock-20261031"
    m = pq.read_schema(root / "harmonized" / "models.parquet")
    assert m.remove_metadata() == MODELS_SCHEMA
    assert report["months_by_origin"] == {"observed_snpp": 175, "converted_aqua": 115,
                                          "converted_terra": 18, "filled_noaa20": 2}


def test_product_rows(built):
    root, _ = built
    h = pd.read_parquet(root / "harmonized" / "harmonized_monthly.parquet")
    assert ((h["value"] > 0) | (h["value_fire_days"] > 0)).all()
    observed = h["origin"] == "observed_snpp"
    assert h.loc[observed, "stratum_id"].isna().all() and h.loc[observed, "model"].isna().all()
    filled = h["origin"].isin(["filled_noaa20", "filled_noaa21"])
    assert h.loc[~observed, "stratum_id"].notna().all() and (h.loc[~observed & ~filled, "model"] == "M1").all()
    assert filled.any() and (h.loc[filled, "model"] == "M0").all()  # VIIRS → VIIRS is always M0
    dim = [calendar.monthrange(y, m)[1] for y, m in zip(h["year"], h["month"])]
    assert (h["value_fire_days"] <= np.array(dim)).all()
    assert set(h.loc[h["year"] < 2002, "origin"]) == {"converted_terra"}
    assert set(h.loc[(h["year"] == 2022) & h["month"].isin([7, 8]), "origin"]) == {"filled_noaa20"}


def test_observed_months_are_snpp_unchanged(built):
    root, _ = built
    h = pd.read_parquet(root / "harmonized" / "harmonized_monthly.parquet")
    g = pd.read_parquet(root / "grid" / "grid_monthly.parquet")
    snpp = g[(g["platform"] == "SNPP") & (g["year"] == 2020)].groupby(["cell_id", "month"])["detections"].sum()
    got = h[h["year"] == 2020].set_index(["cell_id", "month"])["value"]
    assert got.reindex(snpp.index).to_numpy() == pytest.approx(snpp.to_numpy())


def test_models_table(built):
    root, _ = built
    m = pd.read_parquet(root / "harmonized" / "models.parquet")
    assert set(m["model"]) == set(MODELS)
    assert set(m["step"]) == {"aqua_to_snpp", "terra_to_aqua", "noaa20_to_snpp", "noaa21_to_snpp"}
    assert set(m["metric"]) == {"detections", "fire_days"}
    assert (m["n_obs"] >= 30).all()
    viirs = m["step"].isin(["noaa20_to_snpp", "noaa21_to_snpp"])
    # r2_cv exists where held-out rows used that stratum: nearly every tile-month stratum.
    # Fallback strata that no cell ends up using have none.
    tile_month = (m["model"] == "M1") & m["stratum_id"].str.match(r"^t\d+-m\d\d$") & (m["step"] == "aqua_to_snpp")
    assert m.loc[tile_month, "r2_cv"].notna().mean() > 0.9
    # VIIRS → VIIRS steps are always a plain ratio, so their scores are on M0.
    assert m.loc[~viirs & (m["model"] != "M1"), "r2_cv"].isna().all()
    assert m.loc[viirs & (m["model"] != "M0"), "r2_cv"].isna().all()
    assert set(json.loads(m.loc[m["model"] == "M1", "params"].iloc[0])) == {"a", "b", "s"}


def test_no_jump_at_2012_against_the_truth(built):
    """The point of harmonization: relative to the true fires, the series must not jump in 2012."""
    root, _ = built
    h = pd.read_parquet(root / "harmonized" / "harmonized_monthly.parquet")
    g = pd.read_parquet(root / "grid" / "grid_monthly.parquet")
    truth = pd.read_csv(root / "raw" / "truth" / "monthly.csv")
    for rid in ("rio-negro", "nile-delta"):
        w, s, e, n = REGIONS[rid].bbox
        def inside(df):
            r, c = df["cell_id"] // 3600, df["cell_id"] % 3600
            return ((2 * r + 1 - 1800) / 20).between(s - 0.5, n + 0.5) & ((2 * c + 1 - 3600) / 20).between(w - 0.5, e + 0.5)
        t = truth[(truth["region"] == rid) & truth["year"].between(2003, 2025)].groupby("year")["fire_days"].sum()
        harm = h[inside(h) & h["year"].between(2003, 2025)].groupby("year")["value"].sum()
        gr = g[inside(g) & g["year"].between(2003, 2025)]
        raw = pd.concat([gr[(gr["year"] < 2012) & (gr["platform"] == "Aqua")],
                         gr[(gr["year"] >= 2012) & (gr["platform"] == "SNPP")]]).groupby("year")["detections"].sum()
        jump = lambda s: (s / t)[t.index >= 2013].mean() / (s / t)[t.index <= 2011].mean()  # noqa: E731
        assert jump(raw) > 2.0, rid             # stitching raw sensors breaks the series
        assert 0.8 < jump(harm) < 1.25, rid     # harmonized stays level against the truth


def test_cli_rejects_unknown_model(tmp_path):
    with pytest.raises(SystemExit):
        main(["--grid", str(tmp_path), "--model", "M9"])
