from datetime import date

import pandas as pd
import pyarrow.parquet as pq
import pytest

from almatafi import cells
from almatafi.grid import COVERAGE_SCHEMA, GRID_SCHEMA, MASK_SCHEMA, build, floors
from almatafi.ingest import ingest, read_clean
from almatafi.mock.generate import firms_files, generate, write
from tests.test_ingest import MODIS_ROW, VIIRS_ROW, _csv

TODAY = date(2026, 11, 2)
CELL = cells.cell_id(30.1, 31.2)  # MODIS_ROW and VIIRS_ROW both fall here


def _build(tmp_path, modis=(), viirs=(), **kw):
    files = []
    if modis:
        files.append(_csv(tmp_path, list(modis), "modis.csv"))
    if viirs:
        files.append(_csv(tmp_path, list(viirs), "viirs.csv"))
    ingest(files, tmp_path / "clean", tmp_path / "rep", "mock", today=TODAY)
    report = build(tmp_path / "clean", tmp_path / "grid", tmp_path / "rep", **kw)
    read = lambda n: pd.read_parquet(tmp_path / "grid" / f"{n}.parquet")  # noqa: E731
    return read("grid_monthly"), read("coverage"), read("static_mask"), report


def _m(day, time="1130", **kw):
    return MODIS_ROW | {"acq_date": day, "acq_time": time} | kw


def test_detections_and_fire_days(tmp_path):
    rows = [_m("2024-10-01"), _m("2024-10-01", "1131"), _m("2024-10-01", "1132"), _m("2024-10-02")]
    g, _, _, _ = _build(tmp_path, rows)
    assert len(g) == 1
    r = g.iloc[0]
    assert (r.cell_id, r.year, r.month, r.platform, r.daynight) == (CELL, 2024, 10, "Aqua", "D")
    assert (r.detections, r.fire_days) == (4, 2)
    assert r.frp_sum == pytest.approx(4 * 12.3)


def test_rows_split_by_platform_daynight_month_and_cell(tmp_path):
    rows = [_m("2024-10-01"), _m("2024-10-01", "0130", daynight="N"), _m("2024-10-01", satellite="Terra"),
            _m("2024-11-01"), _m("2024-10-01", latitude="10.0")]
    g, _, _, _ = _build(tmp_path, rows)
    assert len(g) == 5 and (g["detections"] == 1).all()


def test_fire_days_use_the_utc_day(tmp_path):
    g, _, _, _ = _build(tmp_path, [_m("2024-10-01", "2359"), _m("2024-10-02", "0001")])
    assert g.iloc[0]["fire_days"] == 2


@pytest.mark.parametrize("threshold,kept", [(30, 2), (50, 1)])
def test_modis_confidence_threshold(tmp_path, threshold, kept):
    rows = [_m("2024-10-01", confidence="29"), _m("2024-10-02", confidence="30"), _m("2024-10-03", confidence="55")]
    g, _, _, r = _build(tmp_path, rows, modis_min_confidence=threshold)
    assert g["detections"].sum() == kept
    assert r["points"]["low_confidence"] == 3 - kept


def test_viirs_low_and_non_vegetation_left_out(tmp_path):
    v = lambda d, **kw: VIIRS_ROW | {"acq_date": d} | kw  # noqa: E731
    rows = [v("2024-10-01"), v("2024-10-02", confidence="l"), v("2024-10-03", type="1"),
            v("2024-10-04", type="3"), v("2024-10-05", type="")]
    g, _, _, r = _build(tmp_path, viirs=rows)
    assert g["detections"].sum() == 2  # type 0 and NRT-style empty type
    assert r["points"] == {"low_confidence": 1, "not_vegetation": 2, "static_mask": 0, "kept": 2}


@pytest.mark.parametrize("months,masked", [(6, True), (5, False)])
def test_static_mask(tmp_path, months, masked):
    static = [_m(f"2024-{m:02d}-15", type="2") for m in range(1, months + 1)]
    fires = [_m("2024-10-01"), _m("2024-10-02", latitude="10.0")]
    g, _, mask, r = _build(tmp_path, static + fires)
    assert (CELL in set(mask["cell_id"])) == masked
    # The vegetation fire in the static cell is dropped only when the cell is masked.
    assert g["detections"].sum() == (1 if masked else 2)
    if masked:
        assert mask.set_index("cell_id").loc[CELL, "months_flagged"] == months
        assert r["points"]["static_mask"] == 1


@pytest.mark.parametrize("ftype", ["1", "3"])
def test_volcano_and_offshore_cells_are_masked_for_nrt(tmp_path, ftype):
    """Type 1 and 3 cells must be masked too, or their NRT rows (no `type`) count as fires."""
    flagged = [_m(f"2025-{m:02d}-15", type=ftype) for m in (3, 4)]
    nrt = [_m("2026-07-01", type="", version="6.1NRT"), _m("2026-07-02", type="", version="6.1NRT")]
    g, _, mask, _ = _build(tmp_path, flagged + nrt)
    assert CELL in set(mask["cell_id"])
    assert g.empty
    one_month = [_m("2025-03-15", type=ftype)]  # a single month is not enough
    (tmp_path / "b").mkdir()
    g, _, mask, _ = _build(tmp_path / "b", one_month + nrt)
    assert CELL not in set(mask["cell_id"]) and g["detections"].sum() == 2


def test_viirs_split_at_the_modis_detection_floor(tmp_path):
    """VIIRS pixels of one fire (same overpass, same 0.02° box) add up; a cluster below MODIS's
    floor is a fire MODIS would have missed. MODIS rows are all "big"."""
    v = lambda **kw: VIIRS_ROW | kw  # noqa: E731
    one_fire = [v(frp="4.0"), v(latitude="30.10112", frp="4.0")]          # 8 MW together
    lone = [v(acq_date="2024-10-16", frp="3.0")]                          # 3 MW
    m = [_m("2024-10-15", scan="1.0", track="1.0")]                         # area 1 km² → day floor 4.96 MW
    g, _, _, r = _build(tmp_path, m, one_fire + lone)
    assert r["modis_floor"] == {"pixel_area_km2": 1.0, "frp_mw": floors(1.0)} and floors(1.0)["D"] == 4.96
    snpp = g[g["platform"] == "SNPP"].iloc[0]
    assert (snpp.detections, snpp.detections_big, snpp.fire_days, snpp.fire_days_big) == (3, 2, 2, 1)
    aqua = g[g["platform"] == "Aqua"].iloc[0]
    assert (aqua.detections_big, aqua.fire_days_big) == (aqua.detections, aqua.fire_days)


def test_coverage_counts_any_detection(tmp_path):
    rows = [_m("2024-10-01", confidence="5"), _m("2024-10-02", type="2"), _m("2024-10-02", "1200"),
            _m("2024-10-03", satellite="Terra")]
    _, cov, _, _ = _build(tmp_path, rows)
    cov = cov.set_index("platform")
    assert cov.loc["Aqua", "observed_days"] == 2 and cov.loc["Terra", "observed_days"] == 1


def test_frp_sum_skips_missing(tmp_path):
    g, _, _, _ = _build(tmp_path, [_m("2024-10-01"), _m("2024-10-02", frp="")])
    assert g.iloc[0]["detections"] == 2 and g.iloc[0]["frp_sum"] == pytest.approx(12.3)


def test_output_schemas(tmp_path):
    _build(tmp_path, [_m("2024-10-01"), *[_m(f"2024-{m:02d}-15", type="2", latitude="20") for m in range(1, 8)]])
    for name, schema in [("grid_monthly", GRID_SCHEMA), ("coverage", COVERAGE_SCHEMA), ("static_mask", MASK_SCHEMA)]:
        s = pq.read_schema(tmp_path / "grid" / f"{name}.parquet")
        assert s.remove_metadata() == schema, name
        assert s.metadata[b"data_version"] == b"mock-20261102"


def test_missing_clean_points(tmp_path):
    with pytest.raises(FileNotFoundError):
        build(tmp_path / "nothing", tmp_path / "grid", tmp_path / "rep")


# --- Review fixes (PR #5)

def test_data_version_is_the_newest_build(tmp_path):
    from almatafi.grid import data_version_of
    ingest([_csv(tmp_path, [_m("2024-10-01")], "a.csv")], tmp_path / "clean", tmp_path / "rep", "archive",
           today=date(2026, 11, 13))
    ingest([_csv(tmp_path, [_m("2023-05-01")], "b.csv")], tmp_path / "clean", tmp_path / "rep", "nrt",
           today=date(2026, 11, 1))
    assert data_version_of(tmp_path / "clean") == "archive-20261113"  # not the alphabetical max


def test_any_folder_name_works(tmp_path):
    odd = tmp_path / "it's a \"test\""
    ingest([_csv(tmp_path, [_m("2024-10-01")])], odd / "clean", odd / "rep", "mock", today=TODAY)
    r = build(odd / "clean", odd / "grid", odd / "rep")
    assert r["grid_rows"] == 1 and r["cells_with_fire"] == 1


@pytest.mark.parametrize("threshold", [30, 50])
def test_grid_records_its_confidence_threshold(tmp_path, threshold):
    _build(tmp_path, [_m("2024-10-01"), _m("2024-10-02", latitude="10.0")], modis_min_confidence=threshold)
    meta = pq.read_schema(tmp_path / "grid" / "grid_monthly.parquet").metadata
    assert meta[b"modis_min_confidence"] == str(threshold).encode()


def test_report_and_grid_use_the_same_filter():
    import duckdb
    import pyarrow as pa

    from almatafi.grid import MASK_SCHEMA, drop_counts, keep_filter
    con = duckdb.connect()
    con.execute("""CREATE TABLE pts AS SELECT * FROM (VALUES
        ('VIIRS', NULL, 'nominal', 0, 1), ('VIIRS', NULL, NULL, 0, 2), ('MODIS', 55, 'nominal', NULL, 3),
        ('MODIS', 10, 'low', 0, 4), ('VIIRS', NULL, 'high', 2, 5))
        AS t(sensor, confidence_pct, confidence_class, fire_type, cell_id)""")
    con.register("mask", pa.table({"cell_id": pa.array([], pa.int32()), "months_flagged": pa.array([], pa.int16())},
                                  schema=MASK_SCHEMA))
    kept = con.sql(f"SELECT COUNT(*) FROM pts WHERE {keep_filter(30)}").fetchall()[0][0]
    counts = drop_counts(con, 30)
    assert kept == counts["kept"] == 2  # the NULL-confidence row is left out by both
    assert counts == {"low_confidence": 2, "not_vegetation": 1, "static_mask": 0, "kept": 2}


def test_partial_coverage_lists_quiet_months():
    import pyarrow as pa

    from almatafi.grid import partial_coverage
    cov = pa.table({"platform": ["Aqua"] * 4, "year": [2024] * 4, "month": [1, 2, 3, 4],
                    "observed_days": [5, 29, 12, 3]})
    # January and April are Aqua's first and last months here, so only March counts.
    assert partial_coverage(cov) == ["Aqua 2024-03 (12/31 days)"]


def test_mock_totals_add_up(tmp_path):
    end = date(2026, 10, 31)
    write(generate(seed=2026, end=end, regions=["nile-delta"]), tmp_path / "raw", seed=2026, end=end, messy_year=None)
    files = firms_files(tmp_path / "raw")
    ingest(files, tmp_path / "clean", tmp_path / "rep", "mock", today=TODAY)
    r = build(tmp_path / "clean", tmp_path / "grid", tmp_path / "rep")
    g = pd.read_parquet(tmp_path / "grid" / "grid_monthly.parquet")
    pts = read_clean(tmp_path / "clean")
    assert g["detections"].sum() == r["points"]["kept"]
    assert sum(r["points"].values()) == len(pts)
    assert r["masked_cells"] >= 2  # the Delta's two industrial sources
    assert (g["fire_days"] <= 31).all() and (g["fire_days"] <= g["detections"]).all()
    # The planted S-NPP outage shows up as missing days.
    cov = pd.read_parquet(tmp_path / "grid" / "coverage.parquet").set_index(["platform", "year", "month"])
    assert cov.loc[("SNPP", 2022, 8), "observed_days"] <= 21


def test_static_mask_covers_the_nrt_months(tmp_path):
    """NRT rows carry no `type`, so only the mask built from standard months keeps
    static sources out of the newest months."""
    end = date(2026, 10, 31)
    write(generate(seed=2026, end=end, regions=["nile-delta"]), tmp_path / "raw", seed=2026, end=end, messy_year=None)
    ingest(firms_files(tmp_path / "raw"), tmp_path / "clean", tmp_path / "rep", "mock", today=TODAY)
    build(tmp_path / "clean", tmp_path / "grid", tmp_path / "rep")
    mask = set(pd.read_parquet(tmp_path / "grid" / "static_mask.parquet")["cell_id"])
    pts = read_clean(tmp_path / "clean")
    nrt = pts[pts["acq_datetime_utc"] >= pd.Timestamp("2026-07-01", tz="UTC")]
    assert len(mask) >= 2 and nrt["fire_type"].isna().all()
    assert nrt["cell_id"].isin(mask).sum() > 0          # the static sources still show up in NRT
    g = pd.read_parquet(tmp_path / "grid" / "grid_monthly.parquet")
    assert not g["cell_id"].isin(mask).any()            # and the grid leaves them out
