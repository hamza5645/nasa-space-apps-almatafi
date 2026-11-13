"""Monthly values for an area, from the grid (raw views) or the harmonized grid.

Nulls follow api.md §1.3: `None` = not observed (sensor not flying, outside the data,
or in the future); `0` = observed, nothing detected.
"""

from __future__ import annotations

import calendar
import json
import logging
from dataclasses import dataclass, field
from datetime import date

import duckdb
import numpy as np
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

from almatafi.grid import keep_filter
from almatafi.platforms import PLATFORMS

from app.data import DataStore
from app.errors import ApiError

log = logging.getLogger(__name__)

YM = tuple[int, int]

VIIRS_FIRST = (2012, 2)  # api.md §1.2: raw VIIRS is null before 2012-02
AQUA_FIRST = (2002, 7)
_end = PLATFORMS["SNPP"].end
# S-NPP's last full month; NOAA-20 stands in for raw VIIRS after it.
SNPP_LAST: YM = (9999, 12) if _end is None else ((_end.year, _end.month - 1) if _end.month > 1 else (_end.year - 1, 12))
UNITS = {
    ("harmonized", "detections"): "VIIRS-equivalent detections per month",
    ("harmonized", "fire_days"): "VIIRS-equivalent fire days per month",
    ("modis", "detections"): "MODIS detections per month (Aqua; Terra before July 2002)",
    ("modis", "fire_days"): "MODIS fire days per month (Aqua; Terra before July 2002)",
    ("viirs", "detections"): "VIIRS detections per month (S-NPP; NOAA-20 after S-NPP ended)",
    ("viirs", "fire_days"): "VIIRS fire days per month (S-NPP; NOAA-20 after S-NPP ended)",
}


def ym_index(ym: YM) -> int:
    return ym[0] * 12 + ym[1] - 1


def ym_from_index(i: int) -> YM:
    return i // 12, i % 12 + 1


def parse_ym(s: str) -> YM:
    return int(s[:4]), int(s[5:7])


def months(first: YM, last: YM) -> list[YM]:
    return [ym_from_index(i) for i in range(ym_index(first), ym_index(last) + 1)]


def era_origin(ym: YM) -> str:
    """Which harmonization step a month comes from when no row says so (PLAN.md §5.3)."""
    if ym < (2002, 7):
        return "converted_terra"
    if ym < VIIRS_FIRST:
        return "converted_aqua"
    return "observed_snpp"


def reference_platform(view: str, ym: YM) -> str:
    """The one platform that stands for a view in a month. Raw views use one platform per
    month, so Terra and Aqua (or two VIIRS satellites) never add up to a fake doubling."""
    if view == "modis" or (view == "harmonized" and ym < VIIRS_FIRST):
        return "Aqua" if ym >= AQUA_FIRST else "Terra"
    return "SNPP" if ym <= SNPP_LAST else "NOAA20"


def _platform_sql(view: str) -> str:
    """reference_platform as SQL over `year` and `month`."""
    ym = "(year * 12 + month - 1)"
    if view == "modis":
        return f"CASE WHEN {ym} >= {ym_index(AQUA_FIRST)} THEN 'Aqua' ELSE 'Terra' END"
    return f"CASE WHEN {ym} <= {ym_index(SNPP_LAST)} THEN 'SNPP' ELSE 'NOAA20' END"


# The cloud correction never scales a cell by more than 1 / CLEAR_MIN (pipeline almatafi.clouds).
CLEAR_MIN = 0.2
# AOI-mean cloud fraction from which a month is called cloudy in the API.
CLOUDY = 0.5
# 0.1° cell id → its 0.5° CMG cell (the 0.5° grid nests the 0.1° one, 5 × 5).
CMG_SQL = "((cell_id // 3600) // 5) * 720 + (cell_id % 3600) // 5"


def cloud_platform_sql() -> str:
    """Which MODIS pass's cloud cover stands for a month: Aqua's 13:30 (VIIRS's overpass time),
    Terra's 10:30 before Aqua flew."""
    return f"CASE WHEN year * 12 + month - 1 >= {ym_index(AQUA_FIRST)} THEN 'Aqua' ELSE 'Terra' END"


@dataclass
class Monthly:
    values: dict[YM, float | None]
    origin: dict[YM, str | None] = field(default_factory=dict)


class Reader:
    """One DuckDB connection per request, with the AOI's cells registered."""

    def __init__(self, data: DataStore, cell_ids: np.ndarray, today: date):
        self.data, self.today = data, today
        self.con = duckdb.connect()
        self.con.execute("SET TimeZone = 'UTC'")
        self.con.register("aoi_cells", pa.table({"cell_id": pa.array(cell_ids, pa.int32())}))
        self._cover: dict[YM, float] | None = None  # cloud_cover's one query per request

    @property
    def current(self) -> YM:
        return self.today.year, self.today.month

    def _need(self, path, what: str, dataset: str):
        if not path.exists():
            log.warning("data_unavailable: %s missing at %s", dataset, path)  # path stays in the server log
            raise ApiError(503, "data_unavailable", f"{what} is not loaded yet.", {"dataset": dataset})
        return path.as_posix()

    def monthly(self, view: str, metric: str, first: YM, last: YM, cloud_correct: bool = False) -> Monthly:
        wanted = months(first, last)
        if view == "harmonized":
            return self._harmonized(metric, wanted, cloud_correct)
        if cloud_correct:
            raise ApiError(422, "bad_request", "The cloud correction is for the harmonized view.")
        return self._raw(view, metric, wanted)

    def _cells_with_clouds(self) -> str:
        """A view of the AOI's cells with their CMG cell, for joins with the cloud product."""
        self.con.execute(f"CREATE OR REPLACE TEMP VIEW aoi_cmg AS SELECT cell_id, {CMG_SQL} AS cmg_id FROM aoi_cells")
        return self.data.clouds.as_posix()

    def cloud_cover(self, first: YM, last: YM) -> dict[YM, float | None]:
        """AOI-mean cloud fraction per month (each 0.1° cell counts once), or {} without the
        cloud product. Months the product doesn't cover are None."""
        if not self.data.clouds.exists():
            return {}
        if self._cover is None:
            path = self._cells_with_clouds()
            rows = self.con.execute(f"""
                SELECT year, month, AVG(cloud_fraction) FROM aoi_cmg JOIN read_parquet('{path}') USING (cmg_id)
                WHERE platform = {cloud_platform_sql()} GROUP BY ALL""").fetchall()
            self._cover = {(int(y), int(m)): float(v) for y, m, v in rows}
        return {ym: self._cover.get(ym) for ym in months(first, last)}

    def _cloud_corrected(self, path: str, col: str) -> str:
        """The AOI's harmonized rows with `col` over each cell's clear share (Giglio et al. 2006),
        as a FROM source. A cell without a cloud row in a month the product covers is unchanged."""
        clouds = self._need(self.data.clouds, "Cloud data", "clouds")
        self._cells_with_clouds()
        return f"""(SELECT cell_id, h.year, h.month, h.origin,
                      h.{col} / GREATEST(1 - COALESCE(c.cloud_fraction, 0), {CLEAR_MIN}) AS {col}
                    FROM read_parquet('{path}') h JOIN aoi_cmg a USING (cell_id)
                    LEFT JOIN read_parquet('{clouds}') c ON c.cmg_id = a.cmg_id AND c.year = h.year
                      AND c.month = h.month
                      AND c.platform = CASE WHEN h.year * 12 + h.month - 1 >= {ym_index(AQUA_FIRST)}
                                            THEN 'Aqua' ELSE 'Terra' END)"""

    def _harmonized(self, metric: str, wanted: list[YM], cloud_correct: bool = False) -> Monthly:
        path = self._need(self.data.harmonized, "Harmonized data", "harmonized")
        col = "value" if metric == "detections" else "value_fire_days"
        if cloud_correct and metric != "detections":
            raise ApiError(422, "bad_request", "The cloud correction is for detections, not fire days.")
        source = f"read_parquet('{path}') JOIN aoi_cells USING (cell_id)"
        no_cloud: set[YM] = set()
        if cloud_correct:
            source = self._cloud_corrected(path, col)
            # A month the cloud product doesn't reach (the real one trails the fire data by months)
            # can't be corrected. Left as it is, it would be compared with corrected months (up to
            # 5× higher) and read as below normal, so it counts as not observed.
            no_cloud = {ym for ym, v in self.cloud_cover(wanted[0], wanted[-1]).items() if v is None}
        meta = pq.read_schema(path).metadata or {}
        if b"covered_start" in meta and b"covered_end" in meta:
            covered = (parse_ym(meta[b"covered_start"].decode()), parse_ym(meta[b"covered_end"].decode()))
        else:
            lo, hi = self.con.execute(f"SELECT MIN(year * 12 + month - 1), MAX(year * 12 + month - 1) "
                                  f"FROM read_parquet('{path}')").fetchone()
            covered = (ym_from_index(lo), ym_from_index(hi))
        # Which platform stood for each month (null = nobody observed it), written by the
        # harmonize build. Older files don't have it; then every covered month counts.
        origins = json.loads(meta[b"month_origins"]) if b"month_origins" in meta else None
        rows = self.con.execute(f"""
            SELECT year, month, origin, SUM({col}) AS v
            FROM {source}
            GROUP BY ALL
        """).fetchall()
        sums: dict[YM, float] = {}
        best: dict[YM, tuple[float, str]] = {}
        for y, m, origin, v in rows:
            sums[(y, m)] = sums.get((y, m), 0.0) + v
            if (y, m) not in best or v > best[(y, m)][0]:
                best[(y, m)] = (v, origin)
        out = Monthly({}, {})
        for ym in wanted:
            known = origins.get(f"{ym[0]}-{ym[1]:02d}") if origins is not None else "?"
            if covered[0] <= ym <= covered[1] and ym <= self.current and known is not None and ym not in no_cloud:
                out.values[ym] = sums.get(ym, 0.0)
                out.origin[ym] = known if known != "?" else (best[ym][1] if ym in best else era_origin(ym))
            else:
                out.values[ym], out.origin[ym] = None, None
        return out

    def _raw(self, view: str, metric: str, wanted: list[YM]) -> Monthly:
        grid = self._need(self.data.grid, "Grid data", "grid")
        cov = self._need(self.data.coverage, "Coverage data", "coverage")
        plat = _platform_sql(view)
        if metric == "detections":
            sql = f"""SELECT year, month, SUM(detections) FROM read_parquet('{grid}') JOIN aoi_cells USING (cell_id)
                      WHERE platform = {plat} GROUP BY ALL"""
        else:
            # Fire days can't be added across passes (the same day would count twice), so
            # each cell takes its best pass: a lower bound on distinct fire days.
            sql = f"""SELECT year, month, SUM(fd) FROM (
                        SELECT cell_id, year, month, MAX(fire_days) AS fd
                        FROM read_parquet('{grid}') JOIN aoi_cells USING (cell_id)
                        WHERE platform = {plat} GROUP BY ALL) GROUP BY ALL"""
        sums = {(y, m): float(v) for y, m, v in self.con.sql(sql).fetchall()}
        observed = {(y, m) for y, m in self.con.sql(
            f"SELECT DISTINCT year, month FROM read_parquet('{cov}') "
            f"WHERE platform = {plat} AND observed_days > 0").fetchall()}
        out = Monthly({})
        for ym in wanted:
            ok = ym in observed and ym <= self.current and (view != "viirs" or ym >= VIIRS_FIRST)
            out.values[ym] = sums.get(ym, 0.0) if ok else None
        return out

    def per_cell(self, view: str, metric: str, first: YM, last: YM,
                 cloud_correct: bool = False) -> tuple[pd.DataFrame, list[YM]]:
        """Values per AOI cell and month (rows only where non-zero), and the observed months.
        A cell missing in an observed month is 0; unobserved months have no value at all."""
        observed = [ym for ym, v in self.monthly(view, metric, first, last, cloud_correct).values.items()
                    if v is not None]
        lo, hi = ym_index(first), ym_index(last)
        if view == "harmonized":
            col = "value" if metric == "detections" else "value_fire_days"
            path = self.data.harmonized.as_posix()
            source = self._cloud_corrected(path, col) if cloud_correct else \
                f"read_parquet('{path}') JOIN aoi_cells USING (cell_id)"
            sql = f"""SELECT cell_id, year, month, {col} AS value FROM {source}
                      WHERE year * 12 + month - 1 BETWEEN {lo} AND {hi}"""
        else:
            agg = "SUM(detections)" if metric == "detections" else "MAX(fire_days)"
            sql = f"""SELECT cell_id, year, month, {agg} AS value FROM read_parquet('{self.data.grid.as_posix()}')
                      JOIN aoi_cells USING (cell_id)
                      WHERE platform = {_platform_sql(view)} AND year * 12 + month - 1 BETWEEN {lo} AND {hi}
                      GROUP BY ALL"""
        df = self.con.sql(sql).df()
        keep = set(observed)
        df = df[np.array([(y, m) in keep for y, m in zip(df["year"], df["month"])], dtype=bool)]
        return df.reset_index(drop=True), observed

    def days_observed(self, view: str, ym: YM) -> int:
        """How far into the month the data reaches: the last UTC day with any hotspot from
        any platform. Without points, the reference platform's day count from coverage."""
        if self.data.has_points():
            self.points_view()
            row = self.con.execute(f"""SELECT MAX(day(acq_datetime_utc)) FROM pts
                                       WHERE year = {ym[0]} AND month = {ym[1]}""").fetchone()
            return int(row[0]) if row and row[0] is not None else 0
        if not self.data.coverage.exists():
            return 0
        row = self.con.execute(f"""SELECT observed_days FROM read_parquet('{self.data.coverage.as_posix()}')
                                   WHERE platform = '{reference_platform(view, ym)}'
                                   AND year = {ym[0]} AND month = {ym[1]}""").fetchone()
        return int(row[0]) if row else 0

    # --- Points (clean GeoParquet) ---

    def points_view(self) -> None:
        clean = self.data.clean
        if not self.data.has_points():
            log.warning("data_unavailable: points missing at %s", clean)
            raise ApiError(503, "data_unavailable", "Hotspot points are not loaded yet.", {"dataset": "points"})
        self.con.execute(f"""CREATE OR REPLACE VIEW pts AS SELECT * FROM read_parquet(
            '{clean.as_posix()}/sensor=*/year=*/*.parquet', hive_partitioning = true)""")
        mask = self.data.root / "grid" / "static_mask.parquet"
        if mask.exists():
            self.con.execute(f"CREATE OR REPLACE VIEW mask AS SELECT cell_id FROM read_parquet('{mask.as_posix()}')")
        else:
            self.con.execute("CREATE OR REPLACE VIEW mask AS SELECT 0::INTEGER AS cell_id WHERE false")

    def share_of_month(self, view: str, ym: YM, days: int) -> float:
        """Share of the month's filtered detections that fell on days 1..`days`, in this AOI.
        Used to compare a partial current month with the same days of past years."""
        dim = calendar.monthrange(*ym)[1]
        fallback = days / dim
        if not self.data.has_points():
            return fallback
        self.points_view()
        row = self.con.execute(f"""
            SELECT COUNT(*) FILTER (WHERE day(acq_datetime_utc) <= {int(days)}), COUNT(*)
            FROM pts JOIN aoi_cells USING (cell_id)
            WHERE year = {ym[0]} AND month = {ym[1]} AND platform = '{reference_platform(view, ym)}'
              AND {keep_filter(30)}
        """).fetchone()
        return row[0] / row[1] if row and row[1] else fallback
