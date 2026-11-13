import json
from datetime import date

import pandas as pd
import pytest

from almatafi.grid import build as build_grid
from almatafi.harmonize.build import build
from almatafi.harmonize.validate import _jump, choose_model, pettitt_p, truth_check
from almatafi.ingest import ingest
from almatafi.mock.generate import firms_files, generate, write


def test_pettitt_finds_a_step_not_noise():
    assert pettitt_p([1, 2, 1, 2, 1, 2, 9, 10, 9, 10, 9, 10]) < 0.05
    assert pettitt_p([5, 3, 6, 4, 5, 3, 6, 4, 5, 3, 6, 4]) > 0.5
    assert pettitt_p([1, 2, 3]) is None


def test_choose_model_best_r2_then_simplest():
    cv = lambda r: {"scores": {"r2": r}}  # noqa: E731
    assert choose_model({"M0": cv(0.90), "M1": cv(0.95), "M2": cv(0.93), "M3": cv(0.94)}) == "M1"
    assert choose_model({"M0": cv(0.95), "M1": cv(0.95), "M2": cv(0.95), "M3": cv(0.95)}) == "M0"
    assert choose_model({"M0": cv(None), "M1": cv(0.2), "M2": cv(None), "M3": cv(None)}) == "M1"
    assert choose_model({"M0": cv(0.9), "M1": cv(0.9), "M2": cv(0.9), "M3": cv(0.97)}) == "M3"


def test_jump_ignores_the_switch_year():
    s = pd.Series([1.0, 1.0, 50.0, 3.0, 3.0], index=[2010, 2011, 2012, 2013, 2014])
    assert _jump(s) == 3.0
    assert _jump(s, s) == 1.0


@pytest.fixture(scope="module")
def run(tmp_path_factory):
    root, end = tmp_path_factory.mktemp("h3"), date(2026, 10, 31)
    write(generate(seed=2026, end=end, regions=["rio-negro", "nile-delta"]), root / "raw", seed=2026, end=end,
          messy_year=None)
    files = firms_files(root / "raw")
    ingest(files, root / "clean", root / "rep", "mock", today=end)
    build_grid(root / "clean", root / "grid", root / "rep")
    report = build(root / "grid", root / "harmonized", root / "rep", model="auto",
                   validation_dir=root / "validation", truth_dir=root / "raw" / "truth")
    v = json.loads((root / "validation" / "validation.json").read_text())
    return root, report, v


def test_validation_json_follows_the_contract(run):
    _, _, v = run
    # data-products.md §4
    assert set(v) >= {"data_version", "metric", "model", "overlap_period", "cross_validation", "overall",
                      "by_model", "break_test", "series", "scatter_sample", "strata"}
    assert v["metric"] == "detections" and v["cross_validation"] == "leave-one-year-out"
    assert v["overlap_period"] == ["2012-02", "2022-12"]  # Aqua's calibration window (orbit drift after)
    assert set(v["overall"]) == {"r2", "bias", "mae", "rmse", "n"} and v["overall"]["n"] > 100
    assert [m["model"] for m in v["by_model"]] == ["M0", "M1", "M2", "M3"]
    assert set(v["break_test"]) == {"raw_ratio_after_vs_before_2012", "harmonized_ratio_after_vs_before_2012",
                                    "pettitt_p_raw", "pettitt_p_harmonized", "placebo_ratios_harmonized"}
    assert v["series"]["years"] == list(range(2001, 2026))
    assert len(v["series"]["raw"]) == len(v["series"]["harmonized"]) == 25
    assert 0 < len(v["scatter_sample"]) <= 2000 and all(len(p) == 2 for p in v["scatter_sample"])
    assert v["strata"]["total"] > 0 and v["strata"]["fallback_used"] >= 0


def test_auto_picks_the_best_model(run):
    _, report, v = run
    best = max(v["by_model"], key=lambda m: m["r2"])["model"]
    assert v["model"] == report["model"] == best
    assert v["overall"]["r2"] > 0.8  # 0.85 on this 2-region mock, 0.98 on all 6 regions


def test_placebo_years_would_catch_a_real_2012_step():
    """Placebo windows stay inside one era, so a step at 2012 shows up as 2012 alone."""
    from almatafi.harmonize.validate import placebo_breaks
    flat = pd.Series(100.0, index=range(2001, 2026))
    stepped = flat.where(flat.index < 2012, 150.0)
    assert set(placebo_breaks(flat).values()) == {1.0}
    assert _jump(stepped) == 1.5 and set(placebo_breaks(stepped).values()) == {1.0}


def test_placebo_years_and_season_shape(run):
    """X14: 2012 should look like any other year in the harmonized series, and the season
    should keep its shape across the switch."""
    _, _, v = run
    placebo = v["break_test"]["placebo_ratios_harmonized"]
    assert set(placebo) == {"2005", "2007", "2017", "2020"}
    assert all(m["r2_1deg"] is not None for m in v["by_model"])
    sc = v["season_check"]
    assert sc["corr_month_shares"] > 0.8  # peak months can differ when two regions peak close together


def test_break_at_2012_is_gone(run):
    _, _, v = run
    b = v["break_test"]
    assert b["raw_ratio_after_vs_before_2012"] > 2
    assert abs(b["harmonized_ratio_after_vs_before_2012"] - 1) < abs(b["raw_ratio_after_vs_before_2012"] - 1) / 5
    for r in v["mock_truth"]["regions"]:
        assert r["raw_jump_vs_truth"] > 2, r["region"]
        assert 0.8 < r["harmonized_jump_vs_truth"] < 1.25, r["region"]
        assert r["corr_harmonized_truth"] > 0.8, r["region"]


def test_files_written(run):
    root, report, _ = run
    for name in ("validation.json", "validation.md", "series.png", "scatter.png", "models.png", "residual_map.png"):
        assert (root / "validation" / name).stat().st_size > 0, name
    md = (root / "validation" / "validation.md").read_text()
    assert "| M0 |" in md and "Break at 2012" in md and "true fires" in md


def test_truth_check_needs_the_mock_files(run, tmp_path):
    root, _, _ = run
    grid = pd.read_parquet(root / "grid" / "grid_monthly.parquet")
    harm = pd.read_parquet(root / "harmonized" / "harmonized_monthly.parquet")
    assert truth_check(grid, harm, tmp_path, 2025) is None


def test_truth_is_skipped_on_real_data(run, tmp_path):
    root, _, _ = run
    import shutil
    shutil.copytree(root / "grid", tmp_path / "grid")
    # Pretend the grid came from the real archive.
    import pyarrow.parquet as pq
    for name in ("grid_monthly.parquet", "coverage.parquet"):
        t = pq.read_table(tmp_path / "grid" / name)
        pq.write_table(t.replace_schema_metadata({b"data_version": b"archive-20261113"}), tmp_path / "grid" / name)
    r = build(tmp_path / "grid", tmp_path / "h", tmp_path / "rep", model="M0",
              validation_dir=tmp_path / "v", truth_dir=root / "raw" / "truth")
    assert r["mock_truth"] is None


def test_raw_join_is_the_apps_raw_view():
    """Raw MODIS = Aqua from July 2002, Terra before; never Terra + Aqua added up."""
    from almatafi.harmonize.validate import annual_series

    rows = [(y, m, p, 10) for y in (2001, 2002, 2003, 2011) for m in range(1, 13) for p in ("Terra", "Aqua")
            if not (p == "Aqua" and (y, m) < (2002, 7))]
    rows += [(2013, m, "SNPP", 40) for m in range(1, 13)]
    grid = pd.DataFrame(rows, columns=["year", "month", "platform", "detections"])
    harm = pd.DataFrame({"year": [2001], "month": [1], "value": [1.0]})
    raw = annual_series(grid, harm, 2013)["raw"]
    assert raw[2001] == raw[2002] == raw[2003] == raw[2011] == 120  # no doubling when Aqua starts
    assert raw[2013] == 480


def test_choose_model_counts_a_zero_r2():
    from almatafi.harmonize.models import MODELS

    cv = {m: {"scores": {"r2": 0.0 if m == "M1" else None}} for m in MODELS}
    assert choose_model(cv) == "M1"  # 0 is a score, None isn't
