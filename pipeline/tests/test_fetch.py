"""X5: the FIRMS download tool, against a fake FIRMS. Nothing here touches the network."""

import json
from datetime import date

import pytest

from almatafi import fetch
from almatafi.fetch import (Boundary, FetchError, Manifest, Response, api_plan, area_url, check_firms_csv,
                            country_jobs, country_url, fetch_api, fetch_countries, fetch_one, main,
                            read_availability)
from almatafi.ingest import ingest, read_clean

KEY = "abcdef0123456789abcdef0123456789"
# Real column layouts (docs/firms-research.md).
VIIRS_SP = ("latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,"
            "version,bright_ti5,frp,daynight,type\n"
            "30.81234,31.01234,330.1,0.39,0.36,2024-10-21,1104,N,VIIRS,n,2,290.2,5.31,D,0\n"
            "30.82234,31.02234,301.5,0.41,0.37,2024-10-21,2315,N,VIIRS,l,2,280.4,1.02,N,0\n")
VIIRS_NRT = ("latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,"
             "version,bright_ti5,frp,daynight\n"
             "-16.28359,29.40531,295.78,0.50,0.66,2026-07-02,1,N20,VIIRS,n,2.0NRT,284.11,1.17,N\n")
MODIS_COUNTRY = ("country_id,latitude,longitude,brightness,scan,track,acq_date,acq_time,satellite,instrument,"
                 "confidence,version,bright_t31,frp,daynight\n"
                 "EGY,30.5,31.1,311.65,1.03,1.02,2026-07-03,236,Terra,MODIS,83,6.1NRT,292.65,10.58,N\n")
AVAIL = ("data_id,min_date,max_date\n"
         "MODIS_NRT,2026-06-01,2026-11-02\nMODIS_SP,2000-11-01,2026-06-30\n"
         "VIIRS_SNPP_NRT,2026-06-01,2026-11-02\nVIIRS_SNPP_SP,2012-01-20,2026-06-30\n"
         "VIIRS_NOAA20_NRT,2026-06-01,2026-11-02\nVIIRS_NOAA21_NRT,2026-06-01,2026-11-02\n"
         "VIIRS_NOAA21_SP,2023-03-01,2026-06-30\n"
         "LANDSAT_NRT,2022-06-20,2026-11-02\n")


class FakeFirms:
    """Answers by URL; records every request."""

    def __init__(self, routes=None, default=Response(404, b"")):
        self.routes, self.default, self.calls = dict(routes or {}), default, []

    def __call__(self, url):
        self.calls.append(url)
        r = self.routes.get(url, self.default)
        return r.pop(0) if isinstance(r, list) else r


def no_sleep(_):
    pass


def test_urls_match_firms():
    assert country_url("viirs-snpp", 2019, "United States") == \
        "https://firms.modaps.eosdis.nasa.gov/data/country/viirs-snpp/2019/viirs-snpp_2019_United_States.csv"
    assert area_url(KEY, "VIIRS_NOAA20_NRT", None, 1) == \
        f"https://firms.modaps.eosdis.nasa.gov/api/area/csv/{KEY}/VIIRS_NOAA20_NRT/world/1"
    assert area_url(KEY, "MODIS_NRT", (29, 29.5, 33, 32), 5, date(2026, 7, 1)).endswith(
        "/MODIS_NRT/29,29.5,33,32/5/2026-07-01")
    with pytest.raises(ValueError):
        area_url(KEY, "MODIS_NRT", None, 10)  # FIRMS allows 1–5 days
    # NOAA-20's country files are "viirs-jpss1" on FIRMS (viirs-noaa20 answers 404).
    assert country_url("viirs-noaa20", 2023, "Egypt").endswith("/viirs-jpss1/2023/viirs-jpss1_2023_Egypt.csv")
    # FIRMS's /api/country is "currently not available" (Nov 13, 2026): nothing may call it.
    assert not hasattr(fetch, "country_api_url")


def test_country_jobs_skip_this_year_and_noaa21():
    jobs = [rel for _, rel in country_jobs(["Egypt"], range(2022, 2027), this_year=2026)]
    assert "modis/2025_Egypt.csv" in jobs and not any("2026" in j for j in jobs)
    assert not any(j.startswith("viirs-noaa21/") for j in jobs)  # FIRMS has no NOAA-21 country files


def test_header_check():
    assert check_firms_csv(VIIRS_SP.encode()) == 2
    assert check_firms_csv(MODIS_COUNTRY.encode()) == 1
    assert check_firms_csv(b"\xef\xbb\xbf" + VIIRS_NRT.encode()) == 1  # BOM
    for bad in (b"<!DOCTYPE html><html>", b"Invalid MAP_KEY.", b"latitude,longitude,foo\n1,2,3\n"):
        with pytest.raises(FetchError):
            check_firms_csv(bad)


def test_countries_download_skip_and_resume(tmp_path):
    egypt = country_url("viirs-snpp", 2024, "Egypt")
    firms = FakeFirms({egypt: Response(200, VIIRS_SP.encode())})
    logs = []
    counts = fetch_countries(["Egypt", "Chile"], range(2011, 2025), tmp_path, firms, products=["viirs-snpp"],
                             sleep=no_sleep, log=logs.append)
    # S-NPP starts 2012: 13 years × 2 countries; only Egypt 2024 exists on the fake. Chile has no
    # file at all, which means a misspelt name, so it counts as failed.
    assert len(firms.calls) == 26 and counts == {"ok": 1, "skipped": 0, "missing": 25, "empty": 0, "failed": 1}
    assert any("Chile" in line and "spelling" in line for line in logs)
    assert (tmp_path / "viirs-snpp" / "2024_Egypt.csv").read_text() == VIIRS_SP
    entry = json.loads((tmp_path / "manifest.json").read_text())["files"]["viirs-snpp/2024_Egypt.csv"]
    assert entry["rows"] == 2 and entry["url"] == egypt and len(entry["sha256"]) == 64

    again = fetch_countries(["Egypt"], range(2024, 2025), tmp_path, FakeFirms(), products=["viirs-snpp"],
                            sleep=no_sleep, log=logs.append)
    assert again["skipped"] == 1 and again["ok"] == 0


def test_retries_server_errors_then_gives_up(tmp_path):
    url = country_url("modis", 2020, "Egypt")
    body = MODIS_COUNTRY.replace("country_id,", "").replace("EGY,", "").encode()
    ok = FakeFirms({url: [Response(503, b""), Response(429, b""), Response(200, body)]})
    waits = []
    res = fetch_one(url, tmp_path, "modis/2020_Egypt.csv", Manifest(tmp_path), ok, sleep=waits.append)
    assert res["status"] == "ok" and waits == [2.0, 4.0]

    down = FakeFirms(default=Response(503, b""))
    with pytest.raises(FetchError, match="HTTP 503"):
        fetch_one(url, tmp_path, "modis/2020_Other.csv", Manifest(tmp_path), down, retries=2, sleep=no_sleep)
    assert len(down.calls) == 3 and not (tmp_path / "modis" / "2020_Other.csv").exists()


def test_bad_file_is_counted_not_written_and_the_run_goes_on(tmp_path):
    a, b = country_url("modis", 2020, "Egypt"), country_url("modis", 2020, "Chile")
    firms = FakeFirms({a: Response(200, b"<html>maintenance</html>"),
                       b: Response(200, MODIS_COUNTRY.replace("country_id,", "").replace("EGY,", "").encode())})
    logs = []
    counts = fetch_countries(["Egypt", "Chile"], range(2020, 2021), tmp_path, firms, products=["modis"],
                             sleep=no_sleep, log=logs.append)
    assert counts["failed"] == 1 and counts["ok"] == 1
    assert not (tmp_path / "modis" / "2020_Egypt.csv").exists()
    assert not list(tmp_path.rglob("*.part"))
    assert any(line.startswith("failed") and "2020_Egypt" in line for line in logs)


def test_refuses_other_hosts(tmp_path):
    for url in ("http://firms.modaps.eosdis.nasa.gov/x.csv", "https://evil.example/x.csv"):
        with pytest.raises(FetchError, match="refusing"):
            fetch_one(url, tmp_path, "x.csv", Manifest(tmp_path), FakeFirms())


def test_availability_and_api_plan():
    avail = read_availability(AVAIL.encode())
    assert avail["MODIS_SP"] == (date(2000, 11, 1), date(2026, 6, 30))
    plan = api_plan(avail, this_year=2026)
    by = {}
    for product, source, first, days in plan:
        by.setdefault(product, []).append((source, first, days))
        assert 1 <= days <= 5
    # This year's standard data first (country files stop at last year), then NRT from the day after.
    assert by["modis"][0] == ("MODIS_SP", date(2026, 1, 1), 5)
    assert [c for c in by["modis"] if c[0] == "MODIS_NRT"][0] == ("MODIS_NRT", date(2026, 7, 1), 5)
    # NOAA-21 has no country files: its standard data starts at its first day.
    assert by["viirs-noaa21"][0] == ("VIIRS_NOAA21_SP", date(2023, 3, 1), 5)
    # NOAA-20 has no SP in the list: NRT from NRT's first day.
    assert by["viirs-noaa20"][0] == ("VIIRS_NOAA20_NRT", date(2026, 6, 1), 5)
    for product, chunks in by.items():
        first, (_, last_start, last_days) = chunks[0][1], chunks[-1]
        covered = sum(d for _, _, d in chunks)
        assert (last_start - first).days + last_days == covered          # no gaps, no overlaps
        assert last_start.toordinal() + last_days - 1 == date(2026, 11, 2).toordinal()
    assert api_plan(avail, ["modis"], until=date(2026, 1, 7)) == [
        ("modis", "MODIS_SP", date(2026, 1, 1), 5), ("modis", "MODIS_SP", date(2026, 1, 6), 2)]


def test_nrt_download_keeps_the_key_secret(tmp_path):
    avail = fetch.availability_url(KEY)
    first = area_url(KEY, "VIIRS_NOAA20_NRT", (29, 29, 33, 32), 5, date(2026, 6, 1))
    firms = FakeFirms({avail: Response(200, AVAIL.encode()), first: Response(200, VIIRS_NRT.encode())},
                      default=Response(200, b""))  # FIRMS answers an empty body when nothing burned
    logs = []
    counts = fetch_api(KEY, (29, 29, 33, 32), "nile-delta", tmp_path, firms, products=["viirs-noaa20"],
                       until=date(2026, 6, 12), sleep=no_sleep, log=logs.append)
    assert counts["ok"] == 1 and counts["empty"] == 2
    assert (tmp_path / "viirs-noaa20" / "nrt_nile-delta_2026-06-01_5d.csv").exists()
    everything = (tmp_path / "manifest.json").read_text() + "\n".join(logs) + \
        "".join(p.name for p in tmp_path.rglob("*"))
    assert KEY not in everything and "***" in (tmp_path / "manifest.json").read_text()

    with pytest.raises(FetchError, match="FIRMS_MAP_KEY"):
        fetch_api("", None, "world", tmp_path, firms)


# A square "country" from 30 to 32 E, 29 to 31 N, with a lake (hole) at 30.8–31.2 E, 29.8–30.2 N,
# and an island at 33.0–33.2 E, 29.0–29.2 N.
SQUARE = {"type": "FeatureCollection", "features": [{"type": "Feature", "properties": {}, "geometry": {
    "type": "MultiPolygon", "coordinates": [
        [[[30, 29], [32, 29], [32, 31], [30, 31], [30, 29]],
         [[30.8, 29.8], [30.8, 30.2], [31.2, 30.2], [31.2, 29.8], [30.8, 29.8]]],
        [[[33.0, 29.0], [33.2, 29.0], [33.2, 29.2], [33.0, 29.2], [33.0, 29.0]]]]}}]}
MODIS_AREA = ("latitude,longitude,brightness,scan,track,acq_date,acq_time,satellite,instrument,"
              "confidence,version,bright_t31,frp,daynight\n"
              "30.5,30.5,311.6,1.0,1.0,2026-01-02,1035,T,MODIS,80,6.1,292.6,10.5,D\n"      # inside
              "30.0,31.0,311.6,1.0,1.0,2026-01-02,1035,T,MODIS,80,6.1,292.6,10.5,D\n"      # in the lake
              "29.1,33.1,311.6,1.0,1.0,2026-01-02,1035,T,MODIS,80,6.1,292.6,10.5,D\n"      # on the island
              "30.5,32.005,311.6,1.0,1.0,2026-01-02,1035,T,MODIS,80,6.1,292.6,10.5,D\n"    # 0.5 km off the edge
              "30.5,32.5,311.6,1.0,1.0,2026-01-02,1035,T,MODIS,80,6.1,292.6,10.5,D\n"      # the neighbour's fire
              "bad,30.5,311.6,1.0,1.0,2026-01-02,1035,T,MODIS,80,6.1,292.6,10.5,D\n")      # left for ingest


def test_boundary_point_in_polygon():
    b = Boundary(SQUARE, "TST_ADM0")
    assert b.bbox == (30.0, 29.0, 33.2, 31.0)
    assert b.fetch_bbox() == (29.95, 28.95, 33.25, 31.05)
    lon = [30.5, 31.0, 33.1, 32.005, 32.5, 31.99, 30.79, 29.0]
    lat = [30.5, 30.0, 29.1, 30.5, 30.5, 30.99, 29.81, 30.0]
    assert b.contains(lon, lat).tolist() == [True, False, True, True, False, True, True, False]
    assert b.contains(lon, lat, slack=0).tolist() == [True, False, True, False, False, True, True, False]
    with pytest.raises(FetchError, match="180"):
        Boundary({"type": "Polygon", "coordinates": [[[-179, 0], [179, 0], [179, 1], [-179, 1], [-179, 0]]]}, "X")
    with pytest.raises(FetchError, match="no polygon"):
        Boundary({"type": "FeatureCollection", "features": []}, "X")


def test_boundary_clip_csv():
    body, kept, dropped = Boundary(SQUARE).clip_csv(MODIS_AREA.encode())
    lines = body.decode().splitlines()
    assert (kept, dropped) == (4, 2) and lines[0] == MODIS_AREA.splitlines()[0]
    assert [ln.split(",")[:2] for ln in lines[1:]] == [["30.5", "30.5"], ["29.1", "33.1"], ["30.5", "32.005"],
                                                        ["bad", "30.5"]]


def test_api_by_country_clips_a_box(tmp_path):
    """--country: the area API with the outline's box, then only the rows inside the outline."""
    box = "29.95,28.95,33.25,31.05"
    firms = FakeFirms({fetch.availability_url(KEY): Response(200, AVAIL.encode()),
                       f"{fetch.BASE}/api/area/csv/{KEY}/MODIS_SP/{box}/5/2026-01-01": Response(200, MODIS_AREA.encode())},
                      default=Response(200, b""))
    logs = []
    counts = fetch_api(KEY, Boundary(SQUARE, "TST_ADM0"), "tst", tmp_path, firms, products=["modis"],
                       until=date(2026, 1, 10), sleep=no_sleep, log=logs.append)
    assert counts["ok"] == 1
    assert all("/api/area/csv/" in u and "/api/country/" not in u for u in firms.calls[1:])
    path = tmp_path / "modis" / "sp_tst_2026-01-01_5d.csv"
    assert len(path.read_text().splitlines()) == 1 + 4
    entry = json.loads((tmp_path / "manifest.json").read_text())["files"]["modis/sp_tst_2026-01-01_5d.csv"]
    assert entry["rows"] == 4 and entry["fetched_rows"] == 6 and entry["rows_outside"] == 2
    assert entry["clipped_to"] == "TST_ADM0" and entry["sha256"] != entry["fetched_sha256"]
    assert any("2 outside TST_ADM0 dropped" in ln for ln in logs)


def test_cli_country_needs_its_outline(tmp_path, monkeypatch, capsys):
    monkeypatch.setenv("FIRMS_MAP_KEY", KEY)
    rc = main(["--out", str(tmp_path / "raw"), "api", "--country", "egy", "--name", "egypt",
               "--outline-dir", str(tmp_path / "outlines")])
    err = capsys.readouterr().err
    assert rc == 1 and "EGY_ADM0.geojson" in err and KEY not in err
    assert f"app.admin --outlines {tmp_path / 'outlines'} EGY" in err


def test_bad_key_error_is_redacted(tmp_path):
    firms = FakeFirms({fetch.availability_url(KEY): Response(200, AVAIL.encode())},
                      default=Response(200, b"Invalid MAP_KEY."))
    logs = []
    counts = fetch_api(KEY, None, "world", tmp_path, firms, products=["modis"], until=date(2026, 1, 3),
                       sleep=no_sleep, log=logs.append)
    assert counts["failed"] == 1 and KEY not in "\n".join(logs)


def test_downloaded_files_ingest(tmp_path):
    """What the tool writes (standard country file + NRT area file with no `type`) ingests as is."""
    sp = country_url("viirs-snpp", 2024, "Egypt")
    fetch_countries(["Egypt"], range(2024, 2025), tmp_path / "raw",
                    FakeFirms({sp: Response(200, VIIRS_SP.encode())}), products=["viirs-snpp"],
                    sleep=no_sleep, log=lambda _: None)
    (tmp_path / "raw" / "viirs-noaa20").mkdir()
    (tmp_path / "raw" / "viirs-noaa20" / "nrt_x_2026-07-02_1d.csv").write_text(VIIRS_NRT)
    (tmp_path / "raw" / "modis").mkdir()
    (tmp_path / "raw" / "modis" / "nrt_x_2026-07-03_1d.csv").write_text(MODIS_COUNTRY)
    files = sorted((tmp_path / "raw").glob("*/*.csv"))
    report = ingest(files, tmp_path / "clean", tmp_path / "rep", "test", today=date(2026, 11, 3))
    assert report["rows_kept"] == 4 and sum(report["dropped"].values()) == 0
    df = read_clean(tmp_path / "clean")
    assert set(df["platform"]) == {"SNPP", "NOAA20", "Terra"}
    assert df.loc[df["platform"] != "SNPP", "fire_type"].isna().all()


def test_cli_rejects_bad_input(capsys, monkeypatch, tmp_path):
    monkeypatch.delenv("FIRMS_MAP_KEY", raising=False)
    assert fetch.main(["--out", str(tmp_path), "nrt", "--bbox", "world", "--name", "w"]) == 1
    assert "FIRMS_MAP_KEY" in capsys.readouterr().err
    with pytest.raises(SystemExit):
        fetch.main(["nrt", "--bbox", "33,29,29,32", "--name", "x"])  # west > east
    with pytest.raises(SystemExit):
        fetch.main(["countries", "--products", "goes"])
