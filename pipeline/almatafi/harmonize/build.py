"""H2: fit every model, apply the chosen one, write the harmonized product.

Writes contracts/data-products.md §3: `harmonized_monthly.parquet` (VIIRS S-NPP-equivalent
detections and fire days per cell-month, day + night summed) and `models.parquet`.
"""

from __future__ import annotations

import calendar
import json
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

from almatafi.harmonize.align import STEPS, VIIRS_STEPS, Aligned, align, load, overlap_pairs
from almatafi.harmonize.models import MODELS, climatology_rows, fit, loyo, predict, scores, small_part, tile_totals
from almatafi.harmonize import validate

METRICS = ("detections", "fire_days")
HARMONIZED_SCHEMA = pa.schema([
    ("cell_id", pa.int32()),
    ("year", pa.int16()),
    ("month", pa.int8()),
    ("value", pa.float32()),
    ("value_fire_days", pa.float32()),
    ("origin", pa.string()),
    ("stratum_id", pa.string()),
    ("model", pa.string()),
])
MODELS_SCHEMA = pa.schema([
    ("metric", pa.string()),   # not in data-products.md 1.0: the two metrics have their own fits
    ("step", pa.string()),
    ("model", pa.string()),
    ("daynight", pa.string()),
    ("stratum_id", pa.string()),
    ("params", pa.string()),
    ("n_obs", pa.int32()),
    ("r2_cv", pa.float32()),
])


def step_model(step: str, chosen: str) -> str:
    """VIIRS → VIIRS steps are one instrument on two satellites: a plain ratio (M0)."""
    return "M0" if step in VIIRS_STEPS else chosen


def fit_all(aligned: Aligned, chosen: str) -> tuple[dict, list[dict]]:
    """Fit every (metric, step, model). r2_cv (leave-one-year-out, per stratum) for the chosen model."""
    fits, rows = {}, []
    for metric in METRICS:
        for step in STEPS:
            pairs = overlap_pairs(aligned, metric, step)
            for model in MODELS:
                params = fit(pairs, model)
                fits[(metric, step, model)] = params
                r2 = {}
                if model == step_model(step, chosen) and len(params):
                    cv = loyo(pairs, model)
                    for key, grp in cv.groupby(["daynight", "stratum_cv"]):
                        r2[key] = scores(grp["y"], grp["pred"])["r2"]
                for (dn, sid), p in params.iterrows():
                    rows.append({"metric": metric, "step": step, "model": model, "daynight": dn,
                                 "stratum_id": sid, "params": json.dumps(_params(p, model)),
                                 "n_obs": int(p["n_obs"]), "r2_cv": r2.get((dn, sid))})
    return fits, rows


def _params(p: pd.Series, model: str) -> dict:
    if model in ("M0", "M3"):  # M3's small-fire climatology is per cell, not per stratum
        return {"k": round(float(p["k"]), 6)}
    if model == "M1":
        return {"a": round(float(p["a"]), 6), "b": round(float(p["b"]), 6), "s": round(float(p["s"]), 6)}
    return {"xq": p["xq"], "yq": p["yq"], "s": round(float(p["s"]), 6)}


def apply(aligned: Aligned, fits: dict, model: str, metric: str) -> pd.DataFrame:
    """Per cell-month-pass: the S-NPP-equivalent value from whichever platform stands for that month."""
    w = aligned.wide[metric].merge(aligned.status[["ym", "origin"]], on="ym")
    w = w[w["origin"].notna()].reset_index(drop=True)
    value = np.zeros(len(w))
    stratum = pd.Series(None, index=w.index, dtype=object)

    obs = (w["origin"] == "observed_snpp").to_numpy()
    value[obs] = w.loc[obs, "SNPP"].to_numpy()

    for origin, step, source in [("filled_noaa20", "noaa20_to_snpp", "NOAA20"),
                                 ("filled_noaa21", "noaa21_to_snpp", "NOAA21"),
                                 ("converted_aqua", "aqua_to_snpp", "Aqua")]:
        sel = (w["origin"] == origin).to_numpy()
        if sel.any():
            m = step_model(step, model)
            value[sel], used = predict(fits[(metric, step, m)], m, w[sel], source)
            stratum[sel] = used.to_numpy()

    terra = (w["origin"] == "converted_terra").to_numpy()
    if terra.any():
        rows = w[terra]
        as_aqua, _ = predict(fits[(metric, "terra_to_aqua", model)], model, rows, "Terra")
        value[terra], used = predict(fits[(metric, "aqua_to_snpp", model)], model,
                                     rows.assign(aqua_equivalent=as_aqua), "aqua_equivalent")
        stratum[terra] = used.to_numpy()
        w.loc[terra, "aqua_equivalent"] = as_aqua

    out = w[["cell_id", "year", "month", "daynight", "origin"]].assign(value=value, stratum_id=stratum)
    if model == "M3":
        conv_months = aligned.status[aligned.status["origin"].isin(["converted_aqua", "converted_terra"])]
        out = pd.concat([out, _climatology_only(w, fits[(metric, "aqua_to_snpp", "M3")], conv_months)],
                        ignore_index=True)
    if metric == "fire_days":
        dim = np.array([calendar.monthrange(y, m)[1] for y, m in zip(out["year"], out["month"])])
        out["value"] = np.minimum(out["value"].to_numpy(), dim)
    return out


def _climatology_only(w: pd.DataFrame, params: pd.DataFrame, conv_months: pd.DataFrame) -> pd.DataFrame:
    """M3: converted months also get the small fires of cells where no platform saw anything,
    including months where MODIS saw nothing at all in the data (then X = 0 everywhere)."""
    empty = pd.DataFrame(columns=["cell_id", "year", "month", "daynight", "origin", "value", "stratum_id"])
    if conv_months.empty:
        return empty
    conv = w[w["origin"].isin(["converted_aqua", "converted_terra"])]
    if "aqua_equivalent" not in conv:
        conv = conv.assign(aqua_equivalent=0.0)
    src = conv.assign(src=np.where(conv["origin"] == "converted_aqua", conv["Aqua"], conv["aqua_equivalent"]))
    months = sorted(zip(conv_months["year"].astype(int), conv_months["month"].astype(int)))
    extra = climatology_rows(params, months, conv)
    if extra.empty:
        return empty
    origin = {(int(y), int(m)): o for y, m, o in zip(conv_months["year"], conv_months["month"], conv_months["origin"])}
    extra["origin"] = [origin[(y, m)] for y, m in zip(extra["year"], extra["month"])]
    extra["value"] = small_part(params, extra, tile_totals(src, "src"))
    extra["stratum_id"] = "climatology"
    return extra[extra["value"] > 0]


def harmonize(aligned: Aligned, fits: dict, model: str) -> pd.DataFrame:
    parts = {}
    for metric in METRICS:
        a = apply(aligned, fits, model, metric)
        a = a.sort_values("daynight")  # "D" first, so a day-pass stratum is the one reported
        parts[metric] = a.groupby(["cell_id", "year", "month"], sort=False).agg(
            value=("value", "sum"), origin=("origin", "first"), stratum_id=("stratum_id", "first"))
    out = parts["detections"].join(parts["fire_days"][["value"]].rename(columns={"value": "value_fire_days"}),
                                   how="outer")
    fd = parts["fire_days"].reindex(out.index)
    out["origin"] = out["origin"].fillna(fd["origin"])
    out["stratum_id"] = out["stratum_id"].fillna(fd["stratum_id"])
    out[["value", "value_fire_days"]] = out[["value", "value_fire_days"]].fillna(0.0)
    out = out[(out["value"] > 0) | (out["value_fire_days"] > 0)].reset_index()
    observed = out["origin"] == "observed_snpp"
    out.loc[observed, "stratum_id"] = None
    # NOAA-filled months are converted with M0 whatever model won (step_model), so say so.
    filled = out["origin"].isin(["filled_noaa20", "filled_noaa21"])
    out["model"] = np.where(observed, None, np.where(filled, step_model("noaa20_to_snpp", model), model))
    return out.sort_values(["year", "month", "cell_id"]).reset_index(drop=True)


def _write(df: pd.DataFrame, schema: pa.Schema, path: Path, meta: dict) -> None:
    table = pa.Table.from_pandas(df[schema.names], schema=schema, preserve_index=False)
    path.parent.mkdir(parents=True, exist_ok=True)
    pq.write_table(table.replace_schema_metadata({k.encode(): str(v).encode() for k, v in meta.items()}), path)


def build(grid_dir: Path, out_dir: Path, reports: Path, model: str = "auto",
          validation_dir: Path | None = None, truth_dir: Path | None = None) -> dict:
    """`model="auto"` picks the model with the best leave-one-year-out R² (H3)."""
    if model not in (*MODELS, "auto"):
        raise ValueError(f"model must be one of {MODELS} or 'auto'")
    grid, coverage = load(grid_dir)
    aligned = align(grid, coverage)
    data_version = (pq.read_schema(grid_dir / "grid_monthly.parquet").metadata or {}).get(
        b"data_version", b"unknown").decode()

    cv = validate.cross_validate(aligned)
    if model == "auto":
        model = validate.choose_model(cv)
    fits, model_rows = fit_all(aligned, model)
    product = harmonize(aligned, fits, model)

    covered = aligned.status[aligned.status["origin"].notna()]
    first, last = covered.iloc[0], covered.iloc[-1]
    meta = {"data_version": data_version, "model": model,
            "covered_start": f"{first.year}-{first.month:02d}", "covered_end": f"{last.year}-{last.month:02d}",
            # Per month, which platform stood for it; null = nobody observed it (not "no fire").
            "month_origins": json.dumps({f"{r.year}-{r.month:02d}": r.origin if isinstance(r.origin, str) else None
                                         for r in aligned.status.itertuples()
                                         if first.ym <= r.ym <= last.ym})}
    _write(product, HARMONIZED_SCHEMA, out_dir / "harmonized_monthly.parquet", meta)
    _write(pd.DataFrame(model_rows, columns=MODELS_SCHEMA.names), MODELS_SCHEMA, out_dir / "models.parquet", meta)

    run_id = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H-%M-%SZ")
    converted = product[product["model"].notna()]
    report = {
        "run_id": run_id, **meta,
        "rows": len(product),
        "months_by_origin": {k: int(v) for k, v in aligned.status["origin"].value_counts().items()},
        # M3's climatology-only rows have no stratum of their own; they're counted apart.
        "strata_used": int(converted.loc[converted["stratum_id"] != "climatology", "stratum_id"].nunique()),
        "fallback_rows": int((~converted["stratum_id"].str.match(r"^t\d+-m\d\d$|^climatology$")).sum()),
        "climatology_rows": int((converted["stratum_id"] == "climatology").sum()),
        "fitted": {f"{m}/{s}/{mod}": len(p) for (m, s, mod), p in fits.items()},
        "r2_by_model": {m: cv[m]["scores"]["r2"] for m in MODELS},
        "outputs": [str(out_dir / "harmonized_monthly.parquet"), str(out_dir / "models.parquet")],
    }
    if validation_dir is not None:
        if truth_dir is not None and not data_version.startswith("mock"):
            truth_dir = None  # the truth check only means something on mock data
        v = validate.validation(aligned, cv, model, grid, product, data_version, truth_dir)
        report["outputs"] += validate.write(v, cv, validation_dir)
        report["break_test"] = v["break_test"]
        report["mock_truth"] = v["mock_truth"]
    reports.mkdir(parents=True, exist_ok=True)
    path, i = reports / f"harmonize_{run_id}.json", 1
    while path.exists():
        i += 1
        path = reports / f"harmonize_{run_id}-{i}.json"
    report["report_path"] = str(path)
    path.write_text(json.dumps(report, indent=2) + "\n")
    return report
