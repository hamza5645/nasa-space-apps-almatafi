import json
from datetime import date

import numpy as np
import pandas as pd
import pytest

from almatafi import cells
from almatafi.mock.__main__ import main
from almatafi.mock.generate import (MESSY_FAULTS, MODIS_COLUMNS, NRT_VERSION, OUTAGES, PRODUCTS,
                                    VIIRS_COLUMNS, firms_files, generate, nrt_start, write)
from almatafi.mock.regions import REGIONS
from almatafi.platforms import PLATFORMS, SATELLITE_ALIASES, platform_for

END = date(2026, 10, 31)
DEMO = ["nile-delta", "rio-negro"]


@pytest.fixture(scope="module")
def result():
    return generate(seed=2026, end=END, regions=DEMO)


@pytest.fixture(scope="module")
def written(result, tmp_path_factory):
    out = tmp_path_factory.mktemp("mock")
    return out, write(result, out, seed=2026, end=END)


def _in(df, region_id):
    w, s, e, n = REGIONS[region_id].bbox
    return df["longitude"].between(w - 0.5, e + 0.5) & df["latitude"].between(s - 0.5, n + 0.5)


def test_headers_match_contract(written):
    out, manifest = written
    files = firms_files(out)
    assert {f.parent.name for f in files} == set(PRODUCTS)
    for f in files:
        header = f.read_text().split("\n", 1)[0].split(",")
        cols = MODIS_COLUMNS if f.parent.name == "modis" else VIIRS_COLUMNS
        # NRT files have no `type` column, like the FIRMS API and NRT downloads.
        assert header == ([c for c in cols if c != "type"] if f.stem.endswith("_nrt") else cols), f


def test_files_split_like_a_real_download(written):
    """One VIIRS satellite per product; the newest months come only as NRT."""
    out, manifest = written
    assert nrt_start(END) == date(2026, 7, 1) and manifest["nrt_from"] == "2026-07-01"
    assert nrt_start(date(2027, 2, 14)) == date(2026, 11, 1)
    for f in firms_files(out):
        df = pd.read_csv(f, dtype=str, keep_default_na=False)
        sensor, sats = PRODUCTS[f.parent.name]
        assert set(df["satellite"]) <= set(sats), f
        if f.stem.endswith("_nrt"):
            assert (df["acq_date"] >= "2026-07-01").all() and set(df["version"]) == {NRT_VERSION[sensor]}
        else:
            assert (df["acq_date"] < "2026-07-01").all() and "NRT" not in "".join(set(df["version"]))
    assert (out / "modis" / "2026_nrt.csv").exists() and (out / "viirs-noaa21" / "2026.csv").exists()
    assert not (out / "viirs-noaa21" / "2022.csv").exists()


@pytest.mark.parametrize("sensor", ["MODIS", "VIIRS"])
def test_values_are_valid(result, sensor):
    df = result[sensor]
    assert len(df) > 10_000
    assert df["latitude"].between(-90, 90).all() and df["longitude"].between(-180, 180).all()
    assert set(df["daynight"]) == {"D", "N"}
    assert set(df["type"]) <= {0, 2}
    assert (df["instrument"] == sensor).all()
    assert df["acq_time"].between(0, 2359).all() and (df["acq_time"] % 100 < 60).all()
    assert (df["frp"] > 0).all()
    assert (df["acq_date"] <= END.isoformat()).all()
    if sensor == "MODIS":
        assert df["confidence"].between(0, 100).all()
        assert (df["scan"] >= 1.0).all() and (df["track"] >= 1.0).all()
        assert df["latitude"].map(lambda x: len(str(x).split(".")[-1])).max() <= 4
    else:
        assert set(df["confidence"]) == {"l", "n", "h"}
        assert (df["scan"] >= 0.375).all() and (df["track"] >= 0.375).all()
    # Every row maps to a valid grid cell.
    assert cells.cell_ids(df["latitude"], df["longitude"]).min() >= 0


@pytest.mark.parametrize("sensor", ["MODIS", "VIIRS"])
def test_platform_timelines_and_outages(result, sensor):
    df = result[sensor]
    for sat, first in df.groupby("satellite")["acq_date"].min().items():
        plat = platform_for(sat)
        assert plat.sensor == sensor
        assert first >= plat.start.isoformat()
    for name, gaps in OUTAGES.items():
        rows = df["satellite"].map(lambda s: platform_for(s).name) == name
        for a, b in gaps:
            assert not (rows & df["acq_date"].between(a.isoformat(), b.isoformat())).any()


@pytest.mark.parametrize("sensor", ["MODIS", "VIIRS"])
def test_no_duplicates(result, sensor):
    key = ["satellite", "latitude", "longitude", "acq_date", "acq_time"]
    assert not result[sensor].duplicated(key).any()


def test_same_seed_same_bytes(written, tmp_path):
    _, first = written
    again = write(generate(seed=2026, end=END, regions=DEMO), tmp_path, seed=2026, end=END)
    assert {k: v["sha256"] for k, v in again["files"].items()} == \
           {k: v["sha256"] for k, v in first["files"].items()}


def test_other_seed_differs(result):
    other = generate(seed=7, end=END, regions=DEMO)
    assert not other["VIIRS"].head(1000).equals(result["VIIRS"].head(1000))


def test_regions_are_independent(result):
    alone = generate(seed=2026, end=END, regions=["rio-negro"])["VIIRS"]
    both = result["VIIRS"][_in(result["VIIRS"], "rio-negro")].reset_index(drop=True)
    pd.testing.assert_frame_equal(alone, both)


def _sat(df, sats, month):
    m = df["acq_date"].str[5:7].astype(int) == month
    d = df[m & df["satellite"].isin(sats) & (df["type"] == 0)]
    return d.groupby(d["acq_date"].str[:4].astype(int)).size()


def test_rio_negro_july_2026_is_unprecedented(result):
    v = result["VIIRS"][_in(result["VIIRS"], "rio-negro")]
    july = _sat(v, ["N"], 7)
    assert july.get(2026, 0) > 3 * july.drop(2026).max()


def test_nile_delta_october_2026_is_above_normal(result):
    v = result["VIIRS"][_in(result["VIIRS"], "nile-delta")]
    october = _sat(v, ["N"], 10)
    assert october[2026] > october.drop(2026).max()
    assert (october[2026] - october.drop(2026).mean()) / october.drop(2026).std() > 2


def test_viirs_sees_more_than_modis_most_of_all_small_fires(result):
    ratios = {}
    for rid in DEMO:
        m = result["MODIS"][_in(result["MODIS"], rid)]
        v = result["VIIRS"][_in(result["VIIRS"], rid)]
        years = lambda d: d["acq_date"].str[:4].between("2013", "2017")  # noqa: E731
        aqua = ((m["satellite"] == "Aqua") & years(m) & (m["type"] == 0)).sum()
        snpp = ((v["satellite"] == "N") & years(v) & (v["type"] == 0)).sum()
        ratios[rid] = snpp / aqua
    assert ratios["rio-negro"] > 1.5
    assert ratios["nile-delta"] > 2 * ratios["rio-negro"]


def test_seasons_follow_the_region(result):
    v = result["VIIRS"][_in(result["VIIRS"], "nile-delta") & (result["VIIRS"]["type"] == 0)]
    by_month = v.groupby(v["acq_date"].str[5:7].astype(int)).size()
    assert by_month.idxmax() in (10, 11)
    r = result["VIIRS"][_in(result["VIIRS"], "rio-negro") & (result["VIIRS"]["type"] == 0)]
    by_month = r.groupby(r["acq_date"].str[5:7].astype(int)).size()
    assert by_month[[12, 1, 2]].sum() > by_month[[5, 6, 8]].sum() * 5


def test_static_sources_flagged(result):
    m = result["MODIS"]
    static = m[m["type"] == 2]
    assert len(static) > 0 and _in(static, "nile-delta").all()
    months = static["acq_date"].str[:7].groupby(static["latitude"].round(1)).nunique()
    assert months.max() >= 6  # enough to trip the static mask (data-products.md)


def test_truth_tables(result):
    monthly = result["monthly"]
    assert set(monthly["region"]) == set(DEMO)
    july = monthly[(monthly["region"] == "rio-negro") & (monthly["month"] == 7)].set_index("year")
    assert july.loc[2026, "fires_started"] > 3 * july.drop(2026)["fires_started"].max()


def test_messy_files_match_their_report(written):
    out, _ = written
    expected = json.loads((out / "messy" / "expected_report.json").read_text())
    assert set(expected) == {"modis_2016.csv", "viirs_2016.csv"}
    for name, rep in expected.items():
        df = pd.read_csv(out / "messy" / name, dtype=str, keep_default_na=False)
        assert len(df) == rep["rows_read"]
        assert rep["rows_read"] - rep["rows_kept"] == sum(rep["dropped"].values())
        assert sum(rep["by_platform"].values()) == rep["rows_kept"]
        assert rep["dropped"] == MESSY_FAULTS
        _check_messy_counts(df, MESSY_FAULTS)


def _before_platform_start(df):
    plat = df["satellite"].map(platform_for)
    known = plat.notna()
    early = pd.Series(False, index=df.index)
    early[known] = df.loc[known, "acq_date"] < plat[known].map(lambda p: p.start.isoformat())
    return early


def _check_messy_counts(df, faults):
    # Counted in the file itself, so the report can't just echo MESSY_FAULTS.
    assert (df["satellite"] == "X9").sum() == faults["unknown_platform"]
    assert ((df["latitude"] == "95.0") | (df["longitude"] == "-200.0")).sum() == faults["bad_coords"]
    assert df["acq_date"].isin(["2016-13-40", "2099-01-01"]).sum() == faults["bad_date"]
    assert (df["frp"] == "-5.0").sum() == faults["bad_frp"]
    assert (df["daynight"] == "X").sum() == faults["bad_daynight"]
    assert _before_platform_start(df).sum() == faults["platform_out_of_range"]
    assert (df["frp"] == "").sum() == 3
    key = ["satellite", "latitude", "longitude", "acq_date", "acq_time"]
    assert df.duplicated(key).sum() == faults["duplicate"]


def test_alias_table_covers_contract():
    # firms-input.md §4.1
    for raw, name in [("T", "Terra"), ("aqua", "Aqua"), ("Suomi-NPP", "SNPP"), ("1", "NOAA20"),
                      ("J2", "NOAA21"), (" N ", "SNPP")]:
        assert platform_for(raw).name == name
    assert platform_for("X9") is None
    assert set(SATELLITE_ALIASES.values()) == set(PLATFORMS)


def test_cli_rejects_bad_args(tmp_path):
    with pytest.raises(SystemExit):
        main(["--out", str(tmp_path), "--regions", "atlantis"])
    with pytest.raises(SystemExit):
        main(["--out", str(tmp_path), "--end", "2099-01-01"])


# --- Review fixes (PR #3)

def test_messy_counts_follow_the_fault_table(result, tmp_path, monkeypatch):
    from almatafi.mock import generate as gen
    faults = {**gen.MESSY_FAULTS, "unknown_platform": 4, "bad_coords": 5, "bad_date": 3, "bad_frp": 1}
    monkeypatch.setattr(gen, "MESSY_FAULTS", faults)
    df = result["MODIS"][result["MODIS"]["acq_date"].str[:4] == "2016"].reset_index(drop=True)
    messy, report = gen.make_messy(df, "MODIS", np.random.default_rng(1))
    assert report["dropped"] == faults
    assert report["rows_read"] - report["rows_kept"] == sum(faults.values())
    path = tmp_path / "m.csv"
    messy.to_csv(path, index=False)
    _check_messy_counts(pd.read_csv(path, dtype=str, keep_default_na=False), faults)


@pytest.mark.parametrize("sensor", ["MODIS", "VIIRS"])
def test_spelling_variants_keep_the_platform(result, sensor):
    from almatafi.mock.generate import make_messy
    df = result[sensor][result[sensor]["acq_date"].str[:4] == "2016"].reset_index(drop=True)
    messy, _ = make_messy(df, sensor, np.random.default_rng(3))
    head = messy.iloc[:len(df)]
    changed = (head["satellite"] != df["satellite"]) & (head["satellite"] != "X9") \
        & ~_before_platform_start(head)
    assert changed.sum() >= 6
    for raw, orig in zip(head.loc[changed, "satellite"], df.loc[changed, "satellite"]):
        assert platform_for(raw).name == platform_for(orig).name, (raw, orig)


def test_end_before_viirs_and_before_messy_year(tmp_path):
    end = date(2011, 12, 31)
    res = generate(seed=2026, end=end, regions=["rio-negro"])
    assert res["VIIRS"].empty and list(res["VIIRS"].columns) == VIIRS_COLUMNS
    manifest = write(res, tmp_path, seed=2026, end=end, messy_year=2016)
    assert not (tmp_path / "messy").exists()
    assert all(k.startswith(("modis/", "truth/")) for k in manifest["files"])


def test_messy_year_with_too_few_rows_is_skipped(tmp_path):
    from almatafi.mock.generate import messy_rows_needed
    end = date(2012, 1, 25)
    manifest = write(generate(seed=2026, end=end, regions=["california"]), tmp_path,
                     seed=2026, end=end, messy_year=2012)
    for k, v in manifest["files"].items():
        if k.startswith("messy/"):
            assert v["rows"] >= messy_rows_needed()


def test_end_before_first_data_is_refused(tmp_path):
    with pytest.raises(ValueError):
        generate(seed=2026, end=date(2000, 10, 15), regions=["rio-negro"])
    with pytest.raises(SystemExit):
        main(["--out", str(tmp_path), "--end", "2000-10-15"])


def test_rerun_removes_files_of_the_previous_run(tmp_path):
    args = ["--out", str(tmp_path), "--regions", "rio-negro", "--messy-year", "0"]
    main(args + ["--end", "2014-12-31"])
    first = json.loads((tmp_path / "manifest.json").read_text())["files"]
    gone = [k for k in first if "2014" in k]
    assert gone and all((tmp_path / k).exists() for k in gone)
    (tmp_path / "notes.txt").write_text("not ours")
    main(args + ["--end", "2012-12-31"])
    assert not any((tmp_path / k).exists() for k in gone)
    assert (tmp_path / "notes.txt").exists()
    listed = json.loads((tmp_path / "manifest.json").read_text())["files"]
    on_disk = {str(p.relative_to(tmp_path)) for p in tmp_path.rglob("*.csv*")}
    assert on_disk == set(listed)


def test_planted_events_check(result):
    from almatafi.mock.checks import planted_events
    got = {e["region"]: e for e in planted_events(result, END)}
    assert got["nile-delta"]["month"] == "2026-10" and got["nile-delta"]["ok"]
    assert got["rio-negro"]["month"] == "2026-07" and got["rio-negro"]["ok"]
    # Another seed can bury the Nile Delta event in the noise; the check must say so.
    weak = planted_events(generate(seed=2, end=END, regions=["nile-delta"]), END)
    assert weak[0]["region"] == "nile-delta" and not weak[0]["ok"]
