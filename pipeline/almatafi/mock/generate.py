"""Mock FIRMS generator (PLAN.md §9).

Truth first: fires are simulated per region with a season, a trend and yearly noise.
Each platform then observes those fires through its own overpass time, clouds,
viewing angle and pixel size, and writes FIRMS CSVs laid out like a real download
(contracts/firms-input.md): standard files, then NRT files for the newest months.
MODIS misses small fires and gives one pixel per fire; VIIRS sees small fires and
splits big ones into several pixels. Same seed → byte-identical files.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd

from almatafi.mock.regions import REGIONS, Region
from almatafi.platforms import PLATFORMS, platform_for

GENERATOR_VERSION = "1.1"
DEFAULT_SEED = 2026
DEFAULT_END = date(2026, 10, 31)
SIM_START = date(2000, 11, 1)

MODIS_COLUMNS = ["latitude", "longitude", "brightness", "scan", "track", "acq_date", "acq_time",
                 "satellite", "instrument", "confidence", "version", "bright_t31", "frp",
                 "daynight", "type"]
VIIRS_COLUMNS = ["latitude", "longitude", "bright_ti4", "scan", "track", "acq_date", "acq_time",
                 "satellite", "instrument", "confidence", "version", "bright_ti5", "frp",
                 "daynight", "type"]

# Overpass groups share clouds and fire activity: 0 Terra day, 1 afternoon (Aqua + VIIRS),
# 2 Terra night, 3 late night (Aqua + VIIRS).
GROUP = {("Terra", "D"): 0, ("Terra", "N"): 2}
GROUP.update({(p, "D"): 1 for p in ("Aqua", "SNPP", "NOAA20", "NOAA21")})
GROUP.update({(p, "N"): 3 for p in ("Aqua", "SNPP", "NOAA20", "NOAA21")})
DIURNAL_FRP = np.array([0.6, 1.0, 0.3, 0.2])  # fire intensity relative to early afternoon

# File layout of a real FIRMS download: one product per satellite for VIIRS (as in the
# yearly country files `data/country/{product}/{year}/...`), MODIS Terra + Aqua together.
PRODUCTS = {"modis": ("MODIS", ("Terra", "Aqua")), "viirs-snpp": ("VIIRS", ("N",)),
            "viirs-noaa20": ("VIIRS", ("N20",)), "viirs-noaa21": ("VIIRS", ("N21",))}
# Standard processing replaces NRT after a few months (the FIRMS API listed MODIS_SP up to
# Jan 31 and NRT up to Jun 6 in the same week), so the newest months only exist as NRT.
NRT_MONTHS = 4
NRT_VERSION = {"MODIS": "6.1NRT", "VIIRS": "2.0NRT"}

# Gaps in a platform's record, so the pipeline has to fill SNPP from NOAA-20.
OUTAGES = {"SNPP": [(date(2022, 7, 26), date(2022, 8, 10))]}


@dataclass(frozen=True)
class Sensor:
    view: float        # chance a location is inside the swath on a given pass
    thr_mw: float      # FRP with a 50% detection chance at nadir, daytime
    nadir_km: float
    edge_scan_km: float
    edge_track_km: float
    decimals: int      # lat/lon decimals in FIRMS files


SENSORS = {
    "MODIS": Sensor(view=0.85, thr_mw=12.0, nadir_km=1.0, edge_scan_km=4.8, edge_track_km=2.0, decimals=4),
    "VIIRS": Sensor(view=0.97, thr_mw=1.5, nadir_km=0.375, edge_scan_km=0.8, edge_track_km=0.78, decimals=5),
}


def _in_polygon(lon: np.ndarray, lat: np.ndarray, poly) -> np.ndarray:
    inside = np.zeros(lon.shape, dtype=bool)
    xs, ys = zip(*poly)
    for i in range(len(poly)):
        x1, y1, x2, y2 = xs[i - 1], ys[i - 1], xs[i], ys[i]
        crosses = (y1 > lat) != (y2 > lat)
        x_at = x1 + (lat - y1) * (x2 - x1) / ((y2 - y1) or 1e-12)
        inside ^= crosses & (lon < x_at)
    return inside


def _inside(region: Region, lon, lat) -> np.ndarray:
    w, s, e, n = region.bbox
    ok = (lon >= w) & (lon <= e) & (lat >= s) & (lat <= n)
    if region.land:
        ok &= _in_polygon(lon, lat, region.land)
    return ok


def _uniform_points(rng, region: Region, n: int):
    w, s, e, n_ = region.bbox
    lon, lat = np.empty(0), np.empty(0)
    while lon.size < n:
        x, y = rng.uniform(w, e, 2 * n + 10), rng.uniform(s, n_, 2 * n + 10)
        keep = _inside(region, x, y)
        lon, lat = np.concatenate([lon, x[keep]]), np.concatenate([lat, y[keep]])
    return lon[:n], lat[:n]


def _fire_points(rng, region: Region, n: int, centres, spread):
    """Fire locations: mostly around the region's clusters, 15% anywhere on its land."""
    lon, lat = np.empty(0), np.empty(0)
    while lon.size < n:
        m = 2 * n + 10
        k = rng.integers(0, len(spread), m)
        x = centres[0][k] + rng.normal(0, spread[k])
        y = centres[1][k] + rng.normal(0, spread[k])
        anywhere = rng.random(m) < 0.15
        ux, uy = _uniform_points(rng, region, int(anywhere.sum()))
        x[anywhere], y[anywhere] = ux, uy
        keep = _inside(region, x, y)
        lon, lat = np.concatenate([lon, x[keep]]), np.concatenate([lat, y[keep]])
    return lon[:n], lat[:n]


def _month_starts(start: date, end: date) -> pd.DatetimeIndex:
    return pd.date_range(pd.Timestamp(start).to_period("M").to_timestamp(), end, freq="MS")


def simulate_events(region: Region, rng, start: date, end: date) -> pd.DataFrame:
    """True fires: one row per fire, plus one long-lived row per static source."""
    months = _month_starts(start, end)
    years = np.arange(months[0].year, months[-1].year + 1)
    yearly_noise = dict(zip(years, rng.lognormal(0, 0.25, years.size)))
    season = np.asarray(region.season) / np.mean(region.season)

    rate = np.array([
        region.fires_per_year / 12 * season[m.month - 1]
        * np.exp(region.trend * (m.year - 2012)) * yearly_noise[m.year]
        * region.planted.get((m.year, m.month), 1.0)
        for m in months
    ]) * rng.lognormal(0, 0.2, len(months))
    counts = rng.poisson(rate)

    month_start = np.repeat(months.values.astype("datetime64[D]"), counts)
    month_days = np.repeat(months.days_in_month.values, counts)
    starts = month_start + (rng.random(counts.sum()) * month_days).astype("timedelta64[D]")

    n = counts.sum()
    centres = _uniform_points(rng, region, region.hotspots)
    spread = rng.uniform(0.05, 0.35, region.hotspots)
    lon, lat = _fire_points(rng, region, n, centres, spread)
    peak = rng.lognormal(np.log(region.frp_median), region.frp_sigma, n)
    # Bigger fires burn longer.
    mean_days = np.clip(region.mean_days * (peak / region.frp_median) ** 0.25, 1, 30)
    days = rng.geometric(1 / mean_days)

    fires = pd.DataFrame({"lat": lat, "lon": lon, "start": starts, "days": days,
                          "peak_frp": peak, "static": False})

    s_lon, s_lat = _uniform_points(rng, region, region.static_sources)
    static = pd.DataFrame({
        "lat": s_lat, "lon": s_lon,
        "start": np.datetime64(start, "D"),
        "days": (np.datetime64(end, "D") - np.datetime64(start, "D")).astype(int) + 1,
        "peak_frp": rng.uniform(4, 12, region.static_sources), "static": True,
    })
    events = pd.concat([fires, static], ignore_index=True)
    events = events[events["start"] <= np.datetime64(end, "D")].reset_index(drop=True)
    events.insert(0, "event_id", [f"{region.id}-{i:06d}" for i in range(len(events))])
    events.insert(1, "region", region.id)
    return events


def burning_days(events: pd.DataFrame, rng, end: date) -> pd.DataFrame:
    """One row per fire per day it burns, with that day's FRP."""
    idx = np.repeat(np.arange(len(events)), events["days"].to_numpy())
    k = np.arange(idx.size) - np.repeat(np.cumsum(events["days"].to_numpy()) - events["days"].to_numpy(),
                                        events["days"].to_numpy())
    ev = events.iloc[idx].reset_index(drop=True)
    day = ev["start"].to_numpy().astype("datetime64[D]") + k.astype("timedelta64[D]")
    n = ev["days"].to_numpy()
    shape = np.where(ev["static"], 1.0, 0.5 + 0.5 * np.sin(np.pi * (k + 0.5) / n))
    out = ev.assign(day=day, frp=ev["peak_frp"].to_numpy() * shape * rng.lognormal(0, 0.4, idx.size))
    return out[out["day"] <= np.datetime64(end, "D")].reset_index(drop=True)


def _pixel_size(sensor: Sensor, scan_frac):
    # Pixels grow towards the swath edge, faster along scan than along track.
    scan = sensor.nadir_km + (sensor.edge_scan_km - sensor.nadir_km) * scan_frac**2
    track = sensor.nadir_km + (sensor.edge_track_km - sensor.nadir_km) * scan_frac**2
    return scan, track


def observe(region: Region, fire_days: pd.DataFrame, rng, end: date) -> dict[str, pd.DataFrame]:
    """Detections per sensor, as FIRMS archive rows."""
    first = np.datetime64(SIM_START, "D")
    n_days = (np.datetime64(end, "D") - first).astype(int) + 2
    day_idx = (fire_days["day"].to_numpy().astype("datetime64[D]") - first).astype(int)
    month = fire_days["day"].dt.month.to_numpy()

    # Clouds per day and overpass group, more of them outside the fire season.
    season = np.asarray(region.season) / max(region.season)
    peak_cloud, quiet_cloud = region.cloud
    cloud_chance = quiet_cloud + (peak_cloud - quiet_cloud) * season
    day_month = pd.DatetimeIndex(first + np.arange(n_days)).month.to_numpy()
    cloudy = rng.random((n_days, 4)) < cloud_chance[day_month - 1][:, None]

    # Fire activity is shared by platforms in the same overpass group.
    group_frp = rng.lognormal(0, 0.4, (len(fire_days), 4))
    group_active = rng.random((len(fire_days), 4))
    static = fire_days["static"].to_numpy()
    lat0, lon0 = fire_days["lat"].to_numpy(), fire_days["lon"].to_numpy()

    rows = {"MODIS": [], "VIIRS": []}
    for name, plat in PLATFORMS.items():
        sensor = SENSORS[plat.sensor]
        in_view = rng.random((n_days, 2)) < sensor.view
        scan_frac = rng.random((n_days, 2))
        jitter_min = rng.normal(0, 15, (n_days, 2))
        on = fire_days["day"].to_numpy() >= np.datetime64(plat.start, "D")
        if plat.end is not None:  # S-NPP stopped on Nov 2, 2026
            on &= fire_days["day"].to_numpy() <= np.datetime64(plat.end, "D")

        for j, (dn, local_h) in enumerate([("D", plat.day_pass), ("N", plat.night_pass)]):
            g = GROUP[(name, dn)]
            active = group_active[:, g] < np.where(static, 0.5, region.active[g])
            frp = fire_days["frp"].to_numpy() * np.where(static, 1.0, DIURNAL_FRP[g]) \
                * group_frp[:, g] * rng.lognormal(0, 0.15, len(fire_days))
            frac = scan_frac[day_idx, j]
            scan, track = _pixel_size(sensor, frac)
            area_ratio = scan * track / sensor.nadir_km**2
            thr = sensor.thr_mw * area_ratio * (0.5 if dn == "N" else 1.0)
            p_detect = 1 / (1 + np.exp(-2.5 * (np.log(frp) - np.log(thr))))
            seen = (on & active & ~cloudy[day_idx, g] & in_view[day_idx, j]
                    & (rng.random(len(fire_days)) < p_detect))
            i = np.nonzero(seen)[0]
            if i.size == 0:
                continue

            # A detection becomes one or more pixels.
            if plat.sensor == "MODIS":
                n_px = 1 + rng.poisson(np.clip(frp[i] / 400, 0, 3))
            else:
                n_px = 1 + rng.poisson(np.clip(frp[i] / (30 * area_ratio[i]), 0, 5))
            p = np.repeat(i, n_px)
            px_frp = np.repeat(frp[i] / n_px, n_px) * rng.lognormal(0, 0.3, p.size)
            sc, tr = scan[p], track[p]
            lat = lat0[p] + rng.normal(0, 0.5 * tr) / 111.2
            lon = lon0[p] + rng.normal(0, 0.5 * sc) / (111.2 * np.cos(np.radians(lat0[p])))

            utc_min = np.round((local_h + jitter_min[day_idx[p], j] / 60 - lon0[p] / 15) * 60).astype(int)
            when = fire_days["day"].to_numpy()[p].astype("datetime64[m]") + utc_min.astype("timedelta64[m]")
            rows[plat.sensor].append(pd.DataFrame({
                "lat": lat, "lon": lon, "frp": px_frp, "scan": sc, "track": tr, "when": when,
                "platform": name, "daynight": dn, "type": np.where(static[p], 2, 0),
            }))

    return {s: _to_firms(s, pd.concat(r, ignore_index=True), rng, end) for s, r in rows.items() if r}


def _to_firms(sensor_name: str, d: pd.DataFrame, rng, end: date) -> pd.DataFrame:
    sensor = SENSORS[sensor_name]
    start = d["platform"].map({p.name: pd.Timestamp(p.start) for p in PLATFORMS.values()})
    acq_day = d["when"].to_numpy().astype("datetime64[D]")
    keep = (acq_day >= start.to_numpy().astype("datetime64[D]")) & (acq_day <= np.datetime64(end, "D"))
    for name, gaps in OUTAGES.items():
        for a, b in gaps:
            keep &= ~((d["platform"] == name).to_numpy()
                      & (acq_day >= np.datetime64(a, "D")) & (acq_day <= np.datetime64(b, "D")))
    d = d[keep]
    d = d[(d["lat"].between(-90, 90)) & (d["lon"].between(-180, 180))].reset_index(drop=True)

    n = len(d)
    night = (d["daynight"] == "N").to_numpy()
    log_frp = np.log1p(d["frp"].to_numpy())
    when = pd.DatetimeIndex(d["when"])
    out = pd.DataFrame({
        "latitude": d["lat"].round(sensor.decimals),
        "longitude": d["lon"].round(sensor.decimals),
        "scan": d["scan"].round(2),
        "track": d["track"].round(2),
        "acq_date": when.strftime("%Y-%m-%d"),
        # FIRMS archive files write HHMM as a plain number, so 00:05 is "5".
        "acq_time": when.hour * 100 + when.minute,
        "satellite": d["platform"].map({p.name: p.satellite for p in PLATFORMS.values()}),
        "instrument": sensor_name,
        "frp": d["frp"].round(2),
        "daynight": d["daynight"],
        "type": d["type"],
    })

    if sensor_name == "MODIS":
        bright = np.where(night, 290, 305) + 18 * log_frp + rng.normal(0, 4, n)
        out["brightness"] = np.clip(bright, 300, 505).round(2)
        out["bright_t31"] = (np.where(night, 282, 298) + 1.5 * log_frp + rng.normal(0, 5, n)).round(2)
        conf = 15 + (out["brightness"].to_numpy() - 320) * 0.9 + rng.normal(0, 15, n)
        out["confidence"] = np.clip(np.round(conf), 0, 100).astype(int)
        out["version"] = "6.1"
    else:
        ti4 = np.minimum(np.where(night, 295, 315) + 13 * log_frp + rng.normal(0, 5, n), 367.0)
        out["bright_ti4"] = ti4.round(2)
        out["bright_ti5"] = (np.where(night, 275, 292) + 3 * log_frp + rng.normal(0, 6, n)).round(2)
        conf = np.where(rng.random(n) < 0.08, "l", "n")
        out["confidence"] = np.where(ti4 >= 367.0, "h", conf)
        out["version"] = "2"

    cols = MODIS_COLUMNS if sensor_name == "MODIS" else VIIRS_COLUMNS
    # generate() sorts all regions together, so no sort here.
    return out[cols].drop_duplicates(["satellite", "latitude", "longitude", "acq_date", "acq_time"])


def truth_monthly(events: pd.DataFrame, fire_days: pd.DataFrame) -> pd.DataFrame:
    """Per region and month: `fires_started`, and `fire_days` = burning days summed over
    fires (one fire burning 3 days counts 3). Not the grid's `fire_days` (distinct days
    with a hotspot in a cell, data-products.md)."""
    fires = events[~events["static"]]
    burning = fire_days[~fire_days["static"]]
    started = fires.groupby(["region", fires["start"].dt.year.rename("year"),
                             fires["start"].dt.month.rename("month")]).size().rename("fires_started")
    days = burning.groupby(["region", burning["day"].dt.year.rename("year"),
                            burning["day"].dt.month.rename("month")]).size().rename("fire_days")
    return pd.concat([started, days], axis=1).fillna(0).astype(int).reset_index()


def generate(seed: int = DEFAULT_SEED, end: date = DEFAULT_END, regions=None) -> dict:
    """Run the simulation in memory. Each region gets its own random stream, so adding
    or removing a region never changes the others."""
    if end < SIM_START:
        raise ValueError(f"end {end} is before the first FIRMS data ({SIM_START})")
    ids = list(regions or REGIONS)
    streams = dict(zip(REGIONS, np.random.SeedSequence(seed).spawn(len(REGIONS))))
    sensors, events, days = {"MODIS": [], "VIIRS": []}, [], []
    for rid in ids:
        region, rng = REGIONS[rid], np.random.default_rng(streams[rid])
        ev = simulate_events(region, rng, SIM_START, end)
        fd = burning_days(ev, rng, end)
        for s, df in observe(region, fd, rng, end).items():
            sensors[s].append(df)
        events.append(ev)
        days.append(fd)
    events, days = pd.concat(events, ignore_index=True), pd.concat(days, ignore_index=True)
    columns = {"MODIS": MODIS_COLUMNS, "VIIRS": VIIRS_COLUMNS}
    # Before 2012 there are no VIIRS rows: keep an empty table with the right columns.
    out = {s: _sorted(pd.concat(dfs, ignore_index=True)) if dfs else pd.DataFrame(columns=columns[s])
           for s, dfs in sensors.items()}
    return {
        **out,
        "events": events,
        "monthly": truth_monthly(events, days),
    }


def _sorted(df: pd.DataFrame) -> pd.DataFrame:
    return df.sort_values(["acq_date", "acq_time", "latitude", "longitude"], kind="mergesort").reset_index(drop=True)


# Faults injected into the messy files; ingest must drop exactly these (firms-input.md §4.4).
MESSY_FAULTS = {"unknown_platform": 3, "bad_coords": 3, "bad_date": 2, "bad_frp": 2,
                "bad_daynight": 2, "platform_out_of_range": 3, "duplicate": 5}


MESSY_VARIANTS, MESSY_MISSING_FRP = 12, 3
# Other spellings of each platform (firms-input.md §4.1), so a variant never changes the platform.
SPELLINGS = {"Terra": [" t", "TERRA"], "Aqua": ["A", "aqua "], "SNPP": ["NPP", "Suomi NPP", "snpp"],
             "NOAA20": ["1", "J1", "noaa-20"], "NOAA21": ["2", "J2", "noaa-21"]}


def messy_rows_needed() -> int:
    """Rows a sensor-year needs before make_messy can pick its faults and variants."""
    return sum(MESSY_FAULTS.values()) + MESSY_VARIANTS + MESSY_MISSING_FRP


def make_messy(df: pd.DataFrame, sensor: str, rng) -> tuple[pd.DataFrame, dict]:
    """One year of clean rows plus known faults and harmless spelling variants."""
    df = df.astype({"acq_time": object, "confidence": object, "frp": object, "satellite": object})
    n_faults = sum(v for k, v in MESSY_FAULTS.items() if k != "duplicate")
    n_variants, n_missing_frp = MESSY_VARIANTS, MESSY_MISSING_FRP
    if len(df) < messy_rows_needed():
        raise ValueError(f"{sensor}: {len(df)} rows, need {messy_rows_needed()} for the messy file")
    pick = rng.choice(len(df), n_faults + n_variants + n_missing_frp + MESSY_FAULTS["duplicate"], replace=False)
    it = iter(pick)
    take = lambda k: [next(it) for _ in range(k)]  # noqa: E731

    # Same order as MESSY_FAULTS, so the counts written are the counts reported.
    df.loc[take(MESSY_FAULTS["unknown_platform"]), "satellite"] = "X9"
    rows = take(MESSY_FAULTS["bad_coords"])
    half = (len(rows) + 1) // 2
    df.loc[rows[:half], "latitude"] = 95.0
    df.loc[rows[half:], "longitude"] = -200.0
    for i, row in enumerate(take(MESSY_FAULTS["bad_date"])):
        df.loc[row, "acq_date"] = ["2016-13-40", "2099-01-01"][i % 2]
    df.loc[take(MESSY_FAULTS["bad_frp"]), "frp"] = -5.0
    df.loc[take(MESSY_FAULTS["bad_daynight"]), "daynight"] = "X"
    rows = take(MESSY_FAULTS["platform_out_of_range"])
    if sensor == "MODIS":
        df.loc[rows, ["satellite", "acq_date"]] = ["Aqua", "2002-01-15"]  # before Aqua's first data
    else:
        df.loc[rows, ["satellite", "acq_date"]] = ["N20", "2016-06-15"]  # before NOAA-20's first data

    rows = take(n_variants)
    if sensor == "MODIS":
        sat_rows = rows
    else:
        sat_rows = rows[:n_variants // 2]
        df.loc[rows[n_variants // 2:], "confidence"] = (["low", "nominal", "high"] * n_variants)[:len(rows) - len(sat_rows)]
    for i, row in enumerate(sat_rows):
        names = SPELLINGS[platform_for(df.loc[row, "satellite"]).name]
        df.loc[row, "satellite"] = names[i % len(names)]
    df.loc[take(n_missing_frp), "frp"] = ""

    messy = pd.concat([df, df.loc[take(MESSY_FAULTS["duplicate"])]], ignore_index=True)
    kept = df.drop(index=pick[:n_faults])
    by_platform = kept["satellite"].map(lambda s: platform_for(s).name).value_counts()
    return messy, {"rows_read": len(messy), "rows_kept": len(kept), "dropped": dict(MESSY_FAULTS),
                   "by_platform": {k: int(v) for k, v in sorted(by_platform.items())},
                   "kept_variants": {"spelling": n_variants, "missing_frp": n_missing_frp}}


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def nrt_start(end: date) -> date:
    """First day served as near real-time: standard processing lags about four months."""
    m = end.year * 12 + end.month - 1 - (NRT_MONTHS - 1)
    return date(m // 12, m % 12 + 1, 1)


def as_nrt(df: pd.DataFrame, sensor: str) -> pd.DataFrame:
    """Rows as the NRT product writes them: `NRT` version suffix and no `type` column."""
    return df.drop(columns="type").assign(version=NRT_VERSION[sensor])


def firms_files(out: Path) -> list[Path]:
    """The mock FIRMS CSVs under `out` (not the messy or truth files)."""
    return sorted(f for p in PRODUCTS for f in (out / p).glob("*.csv"))


def write(result: dict, out: Path, seed: int, end: date, messy_year: int | None = 2016) -> dict:
    """Write FIRMS CSVs per product and year, truth tables, messy files and a manifest.

    Like a real FIRMS download, each VIIRS satellite has its own files, and the last
    NRT_MONTHS months come as NRT files (`{year}_nrt.csv`) instead of standard ones.
    """
    files = {}
    first_nrt = nrt_start(end).isoformat()
    for product, (sensor, sats) in PRODUCTS.items():
        df = result[sensor]
        df = df[df["satellite"].isin(sats)]
        year, nrt = df["acq_date"].str[:4], df["acq_date"] >= first_nrt
        for y in sorted(year.unique()):
            for is_nrt in (False, True):
                part = df[(year == y) & (nrt == is_nrt)]
                if part.empty:
                    continue
                path = out / product / (f"{y}_nrt.csv" if is_nrt else f"{y}.csv")
                path.parent.mkdir(parents=True, exist_ok=True)
                (as_nrt(part, sensor) if is_nrt else part).to_csv(path, index=False)
                files[str(path.relative_to(out))] = len(part)

    truth = out / "truth"
    truth.mkdir(parents=True, exist_ok=True)
    ev = result["events"].assign(start=result["events"]["start"].dt.strftime("%Y-%m-%d"),
                                 peak_frp=result["events"]["peak_frp"].round(2),
                                 lat=result["events"]["lat"].round(5), lon=result["events"]["lon"].round(5))
    ev.to_csv(truth / "events.csv.gz", index=False, compression={"method": "gzip", "mtime": 0})
    result["monthly"].to_csv(truth / "monthly.csv", index=False)
    files["truth/events.csv.gz"] = len(ev)
    files["truth/monthly.csv"] = len(result["monthly"])

    if messy_year:
        rng = np.random.default_rng(np.random.SeedSequence(seed).spawn(len(REGIONS) + 1)[-1])
        expected = {}
        for sensor in ("MODIS", "VIIRS"):
            df = result[sensor]
            df = df[df["acq_date"].str[:4] == str(messy_year)].reset_index(drop=True)
            if len(df) < messy_rows_needed():
                continue  # nothing (or too little) in that year, e.g. VIIRS before 2012
            messy, report = make_messy(df, sensor, rng)
            path = out / "messy" / f"{sensor.lower()}_{messy_year}.csv"
            path.parent.mkdir(parents=True, exist_ok=True)
            messy.to_csv(path, index=False)
            expected[path.name] = report
            files[str(path.relative_to(out))] = len(messy)
        if expected:
            (out / "messy" / "expected_report.json").write_text(json.dumps(expected, indent=2) + "\n")

    manifest = {
        "generator_version": GENERATOR_VERSION,
        "seed": seed,
        "start": SIM_START.isoformat(),
        "end": end.isoformat(),
        "numpy": np.__version__,
        "regions": {r.id: {"name": r.name, "bbox": list(r.bbox),
                           "planted": {f"{y}-{m:02d}": f for (y, m), f in r.planted.items()}}
                    for r in REGIONS.values() if r.id in set(result["events"]["region"])},
        "outages": {p: [[a.isoformat(), b.isoformat()] for a, b in v] for p, v in OUTAGES.items()},
        "nrt_from": first_nrt,
        "files": {k: {"rows": v, "sha256": _sha256(out / k)} for k, v in sorted(files.items())},
    }
    (out / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    return manifest
