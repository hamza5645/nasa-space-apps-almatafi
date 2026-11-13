import json
import struct
from datetime import date
from pathlib import Path

import pandas as pd
import pyarrow.parquet as pq
import pytest

from almatafi import cells
from almatafi.ingest import (SCHEMA, FirmsFormatError, clean, ingest, read_clean,
                             read_firms_csv)
from almatafi.mock.generate import MODIS_COLUMNS, VIIRS_COLUMNS, firms_files, generate, write

TODAY = date(2026, 11, 2)
END = date(2026, 10, 31)

MODIS_ROW = dict(latitude="30.1", longitude="31.2", brightness="330.5", scan="1.1", track="1.0",
                 acq_date="2024-10-15", acq_time="1130", satellite="Aqua", instrument="MODIS",
                 confidence="55", version="6.1", bright_t31="295.2", frp="12.3", daynight="D", type="0")
VIIRS_ROW = dict(latitude="30.10012", longitude="31.20034", bright_ti4="340.1", scan="0.4", track="0.38",
                 acq_date="2024-10-15", acq_time="1130", satellite="N", instrument="VIIRS",
                 confidence="n", version="2", bright_ti5="290.3", frp="3.2", daynight="D", type="0")


def _csv(tmp_path: Path, rows: list[dict], name="f.csv", columns=None) -> Path:
    path = tmp_path / name
    pd.DataFrame(rows, columns=columns or list(rows[0])).to_csv(path, index=False)
    return path


def _clean_rows(tmp_path, rows, **kw):
    raw, sensor, _ = read_firms_csv(_csv(tmp_path, rows, **kw))
    return clean(raw, sensor, "mock", TODAY)


@pytest.fixture(scope="module")
def mock_dir(tmp_path_factory):
    out = tmp_path_factory.mktemp("raw")
    write(generate(seed=2026, end=END, regions=["rio-negro"]), out, seed=2026, end=END)
    return out


@pytest.fixture(scope="module")
def ingested(mock_dir, tmp_path_factory):
    out, reports = tmp_path_factory.mktemp("clean"), tmp_path_factory.mktemp("reports")
    files = firms_files(mock_dir)
    return out, reports, files, ingest(files, out, reports, "mock", today=TODAY)


# --- The messy files: ingest must reproduce the generator's expected report exactly.

@pytest.mark.parametrize("name", ["modis_2016.csv", "viirs_2016.csv"])
def test_messy_file_matches_expected_report(mock_dir, tmp_path, name):
    expected = json.loads((mock_dir / "messy" / "expected_report.json").read_text())[name]
    got = ingest([mock_dir / "messy" / name], tmp_path / "clean", tmp_path / "rep", "mock", today=TODAY)
    assert got["rows_read"] == expected["rows_read"]
    assert got["rows_kept"] == expected["rows_kept"]
    assert {k: v for k, v in got["dropped"].items() if v} == expected["dropped"]
    assert got["by_platform"] == expected["by_platform"]


# --- Full mock run.

def test_clean_mock_keeps_everything(ingested):
    _, _, _, report = ingested
    assert report["rows_kept"] == report["rows_read"] > 10_000
    assert sum(report["dropped"].values()) == 0
    assert report["data_version"] == "mock-20261102"


def test_parquet_schema_and_geo_metadata(ingested):
    out, _, _, _ = ingested
    files = sorted(out.glob("sensor=*/year=*/*.parquet"))
    assert {f.parent.parent.name for f in files} == {"sensor=MODIS", "sensor=VIIRS"}
    schema = pq.read_schema(files[0])
    assert schema.remove_metadata() == pa_schema_without_partitions()
    geo = json.loads(schema.metadata[b"geo"])
    assert geo["version"] == "1.0.0" and geo["primary_column"] == "geometry"
    assert geo["columns"]["geometry"]["encoding"] == "WKB"
    assert schema.metadata[b"data_version"] == b"mock-20261102"


def pa_schema_without_partitions():
    return SCHEMA.remove(SCHEMA.get_field_index("year")).remove(SCHEMA.get_field_index("sensor"))


def test_read_back(ingested):
    out, _, _, report = ingested
    df = read_clean(out)
    assert len(df) == report["rows_kept"]
    assert df["point_id"].is_unique
    assert (df["cell_id"].to_numpy() == cells.cell_ids(df["lat"], df["lon"])).all()
    assert set(df["platform"]) <= {"Terra", "Aqua", "SNPP", "NOAA20", "NOAA21"}
    assert (df["year"] == df["acq_datetime_utc"].dt.year).all()
    assert (df["month"] == df["acq_datetime_utc"].dt.month).all()
    for _, r in df.sample(50, random_state=1).iterrows():
        assert struct.unpack("<BIdd", r["geometry"]) == (1, 1, r["lon"], r["lat"])
    modis = df[df["sensor"] == "MODIS"]
    assert modis["confidence_pct"].notna().all()
    assert df.loc[df["sensor"] == "VIIRS", "confidence_pct"].isna().all()


def test_nrt_tail_reads_like_a_real_download(ingested):
    """The newest months arrive as NRT: no `type` column, `NRT` version suffix."""
    out, _, _, _ = ingested
    df = read_clean(out)
    nrt = df["acq_datetime_utc"] >= pd.Timestamp("2026-07-01", tz="UTC")
    assert nrt.sum() > 100 and (~nrt).sum() > 10_000
    assert df.loc[nrt, "fire_type"].isna().all()
    assert set(df.loc[nrt, "version"]) == {"6.1NRT", "2.0NRT"}
    assert df.loc[~nrt, "fire_type"].notna().all()
    assert set(df.loc[~nrt, "version"]) == {"6.1", "2"}


def test_rerun_replaces_partitions(ingested, tmp_path):
    out, reports, files, first = ingested
    second = ingest(files, out, reports, "mock", today=TODAY)
    assert len(read_clean(out)) == first["rows_kept"]
    assert second["report_path"] != first["report_path"]
    # Same ids as cleaning the same files from scratch.
    fresh = set().union(*(set(clean(*read_firms_csv(f)[:2], "mock", TODAY)[0]["point_id"]) for f in files))
    assert set(read_clean(out)["point_id"]) == fresh and second["already_stored"] == first["rows_kept"]


# --- Unit rules from firms-input.md.

@pytest.mark.parametrize("raw,expected", [("5", "00:05"), ("130", "01:30"), ("0001", "00:01"),
                                          ("1130", "11:30"), ("2359", "23:59")])
def test_unpadded_times(tmp_path, raw, expected):
    df, _ = _clean_rows(tmp_path, [MODIS_ROW | {"acq_time": raw}])
    assert df["acq_datetime_utc"].iloc[0].strftime("%H:%M") == expected


@pytest.mark.parametrize("raw", ["2400", "1260", "12345", "ab", ""])
def test_bad_times_dropped(tmp_path, raw):
    df, dropped = _clean_rows(tmp_path, [MODIS_ROW | {"acq_time": raw}])
    assert len(df) == 0 and dropped["bad_date"] == 1


@pytest.mark.parametrize("pct,cls", [("0", "low"), ("29", "low"), ("30", "nominal"),
                                     ("79", "nominal"), ("80", "high"), ("100", "high")])
def test_modis_confidence_classes(tmp_path, pct, cls):
    df, _ = _clean_rows(tmp_path, [MODIS_ROW | {"confidence": pct}])
    assert df["confidence_class"].iloc[0] == cls and df["confidence_pct"].iloc[0] == int(pct)


@pytest.mark.parametrize("raw,cls", [("l", "low"), ("N", "nominal"), ("high", "high"), (" Nominal ", "nominal")])
def test_viirs_confidence_spellings(tmp_path, raw, cls):
    df, _ = _clean_rows(tmp_path, [VIIRS_ROW | {"confidence": raw}])
    assert df["confidence_class"].iloc[0] == cls


@pytest.mark.parametrize("sat,platform", [("T", "Terra"), (" aqua", "Aqua")])
def test_modis_satellite_spellings(tmp_path, sat, platform):
    df, _ = _clean_rows(tmp_path, [MODIS_ROW | {"satellite": sat}])
    assert df["platform"].iloc[0] == platform


@pytest.mark.parametrize("sat,platform", [("NPP", "SNPP"), ("1", "NOAA20"), ("J2", "NOAA21")])
def test_viirs_satellite_spellings(tmp_path, sat, platform):
    df, _ = _clean_rows(tmp_path, [VIIRS_ROW | {"satellite": sat}])
    assert df["platform"].iloc[0] == platform


@pytest.mark.parametrize("change,key", [
    ({"satellite": "N"}, "unknown_platform"),          # a VIIRS platform inside a MODIS file
    ({"latitude": "abc"}, "bad_coords"),
    ({"longitude": "180.5"}, "bad_coords"),
    ({"acq_date": "2026-11-03"}, "bad_date"),           # tomorrow
    ({"acq_date": "15/10/2024"}, "bad_date"),
    ({"frp": "-1"}, "bad_frp"),
    ({"frp": "x"}, "bad_frp"),
    ({"daynight": "day"}, "bad_daynight"),
    ({"satellite": "Aqua", "acq_date": "2002-07-03"}, "platform_out_of_range"),
    ({"confidence": "abc"}, "bad_value"),
    ({"confidence": "101"}, "bad_value"),
    ({"type": "7"}, "bad_value"),
    ({"scan": ""}, "bad_value"),
])
def test_each_check(tmp_path, change, key):
    df, dropped = _clean_rows(tmp_path, [MODIS_ROW | change])
    assert len(df) == 0 and dropped[key] == 1
    assert sum(dropped.values()) == 1


def test_lenient_values_kept(tmp_path):
    df, dropped = _clean_rows(tmp_path, [MODIS_ROW | {"frp": "", "daynight": "n", "type": ""}])
    assert len(df) == 1 and sum(dropped.values()) == 0
    assert pd.isna(df["frp"].iloc[0]) and pd.isna(df["fire_type"].iloc[0])
    assert df["daynight"].iloc[0] == "N"


def test_first_failing_check_wins(tmp_path):
    _, dropped = _clean_rows(tmp_path, [MODIS_ROW | {"satellite": "X", "latitude": "99"}])
    assert dropped["unknown_platform"] == 1 and dropped["bad_coords"] == 0


def test_duplicates_within_and_across_files(tmp_path):
    a = _csv(tmp_path, [MODIS_ROW, MODIS_ROW, MODIS_ROW | {"acq_time": "1131"}], "a.csv")
    b = _csv(tmp_path, [MODIS_ROW | {"satellite": "A"}], "b.csv")  # same hotspot, other spelling
    r = ingest([a, b], tmp_path / "clean", tmp_path / "rep", "archive", today=TODAY)
    assert r["dropped"]["duplicate"] == 2 and r["rows_kept"] == 2


def _ingest(tmp_path, rows, name, **kw):
    return ingest([_csv(tmp_path, rows, name, **kw)], tmp_path / "clean", tmp_path / "rep", "archive", today=TODAY)


def test_second_file_for_a_year_keeps_the_first(tmp_path):
    # Two per-country files for the same year, ingested in two runs (R1 downloads).
    _ingest(tmp_path, [MODIS_ROW], "2024_EGY.csv")
    r = _ingest(tmp_path, [MODIS_ROW | {"latitude": "-40.84", "longitude": "-68.97"}], "2024_ARG.csv")
    assert r["already_stored"] == 0 and len(read_clean(tmp_path / "clean")) == 2
    again = _ingest(tmp_path, [MODIS_ROW], "2024_EGY.csv")  # re-run: nothing new
    assert again["already_stored"] == 1 and len(read_clean(tmp_path / "clean")) == 2


@pytest.mark.parametrize("order", [("std", "nrt"), ("nrt", "std")])
def test_archive_copy_wins_over_nrt(tmp_path, order):
    rows = {"std": MODIS_ROW | {"version": "6.1", "frp": "12.3"},
            "nrt": MODIS_ROW | {"version": "6.1NRT", "frp": "99.9"}}
    # Across files in one run, in either order.
    paths = [_csv(tmp_path, [rows[k]], f"{k}.csv") for k in order]
    r = ingest(paths, tmp_path / "one", tmp_path / "rep", "archive", today=TODAY)
    assert r["dropped"]["duplicate"] == 1
    assert read_clean(tmp_path / "one")["version"].tolist() == ["6.1"]
    # Across runs, in either order.
    for k in order:
        ingest([tmp_path / f"{k}.csv"], tmp_path / "two", tmp_path / "rep", "archive", today=TODAY)
    assert read_clean(tmp_path / "two")["version"].tolist() == ["6.1"]


@pytest.mark.parametrize("change", [{"frp": "inf"}, {"scan": "inf"}, {"brightness": "-inf"},
                                    {"latitude": "nan"}, {"instrument": "VIIRS"}])
def test_non_finite_and_wrong_instrument_dropped(tmp_path, change):
    df, dropped = _clean_rows(tmp_path, [MODIS_ROW | change])
    assert len(df) == 0 and sum(dropped.values()) == 1


def test_platform_end_date(tmp_path, monkeypatch):
    import dataclasses
    from types import SimpleNamespace

    from almatafi import platforms
    snpp = {**dataclasses.asdict(platforms.PLATFORMS["SNPP"]), "end": date(2026, 11, 2)}
    monkeypatch.setitem(platforms.PLATFORMS, "SNPP", SimpleNamespace(**snpp))
    rows = [VIIRS_ROW | {"acq_date": d} for d in ["2026-11-02", "2026-11-03"]]
    raw, sensor, _ = read_firms_csv(_csv(tmp_path, rows))
    df, dropped = clean(raw, sensor, "mock", date(2026, 11, 5))
    assert len(df) == 1 and dropped["platform_out_of_range"] == 1


def test_point_id_text_uses_python_floats():
    import hashlib

    from almatafi.ingest import point_ids
    df = pd.DataFrame({"platform": ["Aqua"], "lat": [30.1], "lon": [31.2],
                       "acq_datetime_utc": pd.to_datetime(["2024-10-15 11:30"]).tz_localize("UTC")})
    want = hashlib.sha1(b"Aqua|30.1|31.2|2024-10-15T11:30:00Z").hexdigest()[:16]
    assert point_ids(df) == [want]
    assert point_ids(df.assign(lat=df["lat"].astype("float32").astype("float64").round(5))) == [want]


def test_nrt_file_without_type(tmp_path):
    cols = [c for c in VIIRS_COLUMNS if c != "type"]
    df, dropped = _clean_rows(tmp_path, [VIIRS_ROW], columns=cols)
    assert len(df) == 1 and pd.isna(df["fire_type"].iloc[0])


def test_header_checks(tmp_path):
    with pytest.raises(FirmsFormatError, match="neither"):
        read_firms_csv(_csv(tmp_path, [{"a": 1, "b": 2}]))
    with pytest.raises(FirmsFormatError, match="frp"):
        read_firms_csv(_csv(tmp_path, [MODIS_ROW], columns=[c for c in MODIS_COLUMNS if c != "frp"]))
    _, sensor, extra = read_firms_csv(_csv(tmp_path, [MODIS_ROW | {"country_id": "EGY"}]))
    assert sensor == "MODIS" and extra == ["country_id"]


def test_point_id_is_stable(tmp_path):
    df, _ = _clean_rows(tmp_path, [MODIS_ROW])
    again, _ = _clean_rows(tmp_path, [MODIS_ROW | {"latitude": "30.10", "satellite": "A"}])
    assert df["point_id"].iloc[0] == again["point_id"].iloc[0]
    assert len(df["point_id"].iloc[0]) == 16


def test_auto_source_labels_each_row_from_its_version(tmp_path):
    """A real download mixes standard and NRT files for the same year; one run labels each row."""
    sp = _csv(tmp_path, [MODIS_ROW | {"version": "6.1"}], "sp.csv")
    nrt = _csv(tmp_path, [MODIS_ROW | {"version": "6.1NRT", "acq_time": "1131"}], "nrt.csv")
    viirs = _csv(tmp_path, [VIIRS_ROW | {"version": "2.0NRT"}], "v.csv")
    r = ingest([sp, nrt, viirs], tmp_path / "clean", tmp_path / "rep", "auto", today=TODAY)
    df = read_clean(tmp_path / "clean")
    assert sorted(zip(df["version"], df["source"])) == [("2.0NRT", "nrt"), ("6.1", "archive"), ("6.1NRT", "nrt")]
    assert r["data_version"].startswith("firms-")
