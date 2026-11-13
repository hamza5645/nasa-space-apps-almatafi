from datetime import date

import pandas as pd
import pytest

from almatafi import cells
from almatafi.grid import build
from almatafi.harmonize.align import (FULL, LEVELS, MIN_PAIRS, add_strata, align, assign_strata, load,
                                      month_status, overlap_pairs, stratum_sizes, wide)
from almatafi.ingest import ingest
from almatafi.mock.generate import firms_files, generate, write


def _cov(rows):
    return pd.DataFrame(rows, columns=["platform", "year", "month", "observed_days"])


def _status(rows):
    return month_status(_cov(rows)).set_index(["year", "month"])


def test_origin_by_era():
    st = _status([("Terra", 2001, 1, 31), ("Terra", 2002, 7, 31), ("Aqua", 2002, 7, 31),
                  ("Aqua", 2012, 1, 31), ("Aqua", 2012, 2, 29), ("SNPP", 2012, 2, 29), ("SNPP", 2012, 3, 31)])
    assert st.loc[(2001, 1), "origin"] == "converted_terra"
    assert pd.isna(st.loc[(2001, 2), "origin"])                 # nobody observed
    assert st.loc[(2002, 7), "origin"] == "converted_aqua"
    assert st.loc[(2012, 1), "origin"] == "converted_aqua"      # S-NPP not yet in the record
    assert st.loc[(2012, 2), "origin"] == "observed_snpp"


def test_outage_filled_by_noaa20_only_when_noaa20_is_complete():
    st = _status([("SNPP", 2022, 7, 20), ("NOAA20", 2022, 7, 31), ("SNPP", 2022, 8, 20),
                  ("NOAA20", 2022, 8, 10), ("SNPP", 2022, 9, 30), ("NOAA20", 2022, 9, 30)])
    assert st.loc[(2022, 7), "origin"] == "filled_noaa20"
    assert st.loc[(2022, 8), "origin"] == "observed_snpp"       # NOAA-20 no better
    assert st.loc[(2022, 9), "origin"] == "observed_snpp"


def test_after_snpp_stopped_noaa20_then_noaa21_carry_the_record():
    """FIRMS: S-NPP data ceased on Nov 2, 2026. NOAA-20 fills; without it, NOAA-21."""
    st = _status([("SNPP", 2026, 11, 2), ("NOAA20", 2026, 11, 30), ("NOAA21", 2026, 11, 30),
                  ("NOAA21", 2026, 12, 31), ("SNPP", 2026, 10, 31), ("NOAA20", 2026, 10, 31)])
    assert st.loc[(2026, 10), "origin"] == "observed_snpp"
    assert st.loc[(2026, 11), "origin"] == "filled_noaa20"
    assert st.loc[(2026, 12), "origin"] == "filled_noaa21"


def test_after_snpp_stopped_a_partly_covered_noaa_month_still_stands_in():
    """On a small area, coverage counts quiet days as gaps (X21), so NOAA-20 can look partial.
    After S-NPP's end it must still stand for the month: not S-NPP's last 2 days, not Aqua."""
    st = _status([("SNPP", 2026, 11, 2), ("NOAA20", 2026, 11, 10), ("Aqua", 2026, 11, 13),
                  ("NOAA20", 2026, 12, 24), ("Aqua", 2026, 12, 31), ("NOAA21", 2027, 1, 5), ("Aqua", 2027, 1, 31)])
    assert st.loc[(2026, 11), "origin"] == "filled_noaa20"
    assert st.loc[(2026, 12), "origin"] == "filled_noaa20"
    assert st.loc[(2027, 1), "origin"] == "filled_noaa21"


def test_quiet_month_is_not_an_outage():
    # Both satellites "miss" a few days because nothing burned; that's not an S-NPP gap.
    st = _status([("SNPP", 2025, 7, 26), ("NOAA20", 2025, 7, 28)])
    assert st.loc[(2025, 7), "origin"] == "observed_snpp"


def test_partial_last_month_is_not_an_outage():
    st = _status([("SNPP", 2026, 9, 30), ("SNPP", 2026, 10, 12), ("NOAA20", 2026, 10, 12)])
    assert st.loc[(2026, 10), "frac_SNPP"] == 1.0 and st.loc[(2026, 10), "origin"] == "observed_snpp"


GRID = pd.DataFrame([
    # cell, year, month, platform, daynight, detections, fire_days
    (4325712, 2015, 10, "Aqua", "D", 3, 2), (4325712, 2015, 10, "Aqua", "N", 1, 1),
    (4325712, 2015, 10, "SNPP", "D", 12, 5), (4325712, 2015, 10, "SNPP", "N", 4, 3),
    (4325712, 2015, 11, "SNPP", "D", 2, 1),
], columns=["cell_id", "year", "month", "platform", "daynight", "detections", "fire_days"])


def test_wide_detections_keeps_passes_apart():
    w = wide(GRID, "detections").set_index(["year", "month", "daynight"])
    assert w.loc[(2015, 10, "D"), ["Aqua", "SNPP", "Terra"]].tolist() == [3, 12, 0]
    assert w.loc[(2015, 10, "N"), ["Aqua", "SNPP"]].tolist() == [1, 4]
    assert w.loc[(2015, 11, "D"), "Aqua"] == 0


def test_wide_fire_days_takes_the_best_pass():
    w = wide(GRID, "fire_days").set_index(["year", "month"])
    assert w.loc[(2015, 10), ["Aqua", "SNPP"]].tolist() == [2, 5]
    assert set(w["daynight"]) == {"A"}


@pytest.mark.parametrize("lat,lon,month", [(30.1, 31.2, 10), (-40.84, -68.97, 7), (89.95, 179.95, 1), (-89.95, -179.95, 12)])
def test_strata_match_the_grid_contract(lat, lon, month):
    df = add_strata(pd.DataFrame({"cell_id": [cells.cell_id(lat, lon)], "month": [month]}))
    chain = cells.stratum_chain(lat, lon, month)
    assert df[LEVELS[:4]].iloc[0].tolist() == chain
    assert df["s_global_all"].iloc[0] == "g-mall"


def test_assign_strata_walks_the_fallback_chain():
    rows = add_strata(pd.DataFrame({"cell_id": [cells.cell_id(30.1, 31.2)] * 3, "month": [10, 10, 10],
                                    "daynight": ["D", "N", "A"]}))
    available = {("D", "t453-m10"), ("N", "b12-m10"), ("A", "g-mall")}
    assert assign_strata(rows, available).tolist() == ["t453-m10", "b12-m10", "g-mall"]
    assert assign_strata(rows, set()).isna().all()


@pytest.fixture(scope="module")
def mock(tmp_path_factory):
    root, end = tmp_path_factory.mktemp("h1"), date(2026, 10, 31)
    write(generate(seed=2026, end=end, regions=["rio-negro", "nile-delta"]), root / "raw", seed=2026, end=end, messy_year=None)
    files = firms_files(root / "raw")
    ingest(files, root / "clean", root / "rep", "mock", today=end)
    build(root / "clean", root / "grid", root / "rep")
    return align(*load(root / "grid"))


def test_mock_eras_and_planted_outage(mock):
    st = mock.status.set_index(["year", "month"])["origin"]
    assert (st.loc[(2001, 1):(2002, 6)] == "converted_terra").all()
    assert (st.loc[(2002, 7):(2012, 1)] == "converted_aqua").all()
    assert st.loc[(2022, 7)] == st.loc[(2022, 8)] == "filled_noaa20"   # D1's S-NPP outage
    others = st.loc[(2012, 2):].drop([(2022, 7), (2022, 8)])
    assert (others == "observed_snpp").all()


@pytest.mark.parametrize("step,first,last", [("aqua_to_snpp", (2012, 2), (2022, 12)),
                                             ("terra_to_aqua", (2003, 1), (2011, 12)),
                                             ("noaa20_to_snpp", (2018, 4), (2026, 10)),
                                             ("noaa21_to_snpp", (2023, 3), (2026, 10))])
def test_overlap_pairs(mock, step, first, last):
    """Each step is fitted only inside its window (Aqua's orbit drift after 2022, Terra on
    Aqua's first full years)."""
    p = overlap_pairs(mock, "detections", step)
    assert len(p) > 300
    ym = p["year"] * 12 + p["month"]
    assert (ym >= first[0] * 12 + first[1]).all() and (ym <= last[0] * 12 + last[1]).all()
    assert (p["y_big"] <= p["y"]).all()
    assert set(p.attrs["overlap_months"]) >= set(zip(p["year"], p["month"]))
    assert ((p["x"] > 0) | (p["y"] > 0)).all()
    if step.endswith("snpp"):
        # S-NPP outage months can't be used: a gap would look like "no fire".
        assert not ((p["year"] == 2022) & p["month"].isin([7, 8])).any()


def test_viirs_sees_more_than_aqua_in_the_overlap(mock):
    p = overlap_pairs(mock, "detections", "aqua_to_snpp")
    assert p["y"].sum() > 2 * p["x"].sum()
    st = mock.status.set_index("ym")
    assert (st.loc[p["ym"].unique(), "frac_SNPP"] >= FULL).all()


def test_every_cell_month_finds_a_stratum(mock):
    p = overlap_pairs(mock, "detections", "aqua_to_snpp")
    ok = {k for k, n in stratum_sizes(p).items() if n >= MIN_PAIRS}
    chosen = assign_strata(mock.wide["detections"], ok)
    assert chosen.notna().all()
    assert chosen.str.startswith("t").mean() > 0.9  # most cells get their own 10° tile
