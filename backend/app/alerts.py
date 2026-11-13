""""Unusual month" alerts (X27), a scratch version: nothing is ever emailed.

FIRMS emails every new detection in an area (near real time, daily or weekly). Ours would
say something FIRMS can't: that an area's month is out of the ordinary against 25 years.
This builds that email and stops there:

- POST /api/alerts/preview: the alert an area would get right now (the current month so
  far, against the same days of past years; the last month if this one has no data yet).
  It takes no email address and stores nothing.
- python -m app.alerts add|run: local subscriptions in data/alerts/subscriptions.json; `run`
  checks each one and writes the triggered alerts as .eml files to data/alerts/outbox/.
  There is no mail server, by design; sending is a decision for after the event.
"""

from __future__ import annotations

import argparse
import html
import json
import re
import sys
import uuid
from datetime import date, datetime, timezone
from email.message import EmailMessage
from pathlib import Path
from typing import TYPE_CHECKING, Literal

from fastapi import APIRouter, Request
from pydantic import BaseModel

from app.aoi import Aoi
from app.errors import ApiError
from app.routes import Clouds, StatsRequest, stats

if TYPE_CHECKING:
    from fastapi.testclient import TestClient

router = APIRouter(prefix="/api")

Threshold = Literal["above_normal", "unusual_high"]
# Statuses from analytics.status_for, lowest to highest.
LEVEL = {"below_normal": 0, "normal": 1, "above_normal": 2, "unusual_high": 3}
SITE = "https://almatafi.monitorthesituations.com"
FROM = "Almatafi alerts (demo) <alerts@almatafi.invalid>"
MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September",
          "October", "November", "December"]
SAYS = {"unusual_high": "unusually high", "above_normal": "above normal", "normal": "within the normal range",
        "below_normal": "below normal"}


class PreviewRequest(BaseModel):
    aoi: Aoi
    name: str | None = None          # how the email names the area; plain text, escaped
    threshold: Threshold = "above_normal"
    clouds: Clouds = "off"


def _shift(ym: tuple[int, int], k: int) -> tuple[int, int]:
    i = ym[0] * 12 + ym[1] - 1 + k
    return i // 12, i % 12 + 1


def _clean_name(name: str | None) -> str:
    name = re.sub(r"\s+", " ", name or "").strip()
    return name[:80] or "your area"


def evaluate(request: Request, aoi, threshold: str = "above_normal", clouds: str = "off") -> dict:
    """/stats for the current month (partial, against the same days of past years), or for the
    last month when this one has no data yet."""
    today = request.app.state.today()
    last_error = None
    for ym in ((today.year, today.month), _shift((today.year, today.month), -1)):
        month = f"{ym[0]}-{ym[1]:02d}"
        try:
            s = stats(StatsRequest(aoi=aoi, month=month, clouds=clouds), request)
        except ApiError as e:
            if e.status == 422:
                last_error = e
                continue
            raise
        status = s.get("status")
        triggered = status is not None and LEVEL[status] >= LEVEL[threshold]
        return {"month": month, "stats": s, "triggered": triggered}
    raise last_error  # type: ignore[misc]


def render(result: dict, name: str | None, threshold: str) -> dict:
    """Subject, plain text and HTML (every value escaped) for one evaluation."""
    s, place = result["stats"], _clean_name(name)
    y, m = (int(v) for v in result["month"].split("-"))
    label = f"{MONTHS[m - 1]} {y}"
    partial = s.get("partial")
    so_far = f" so far ({partial['days_observed']} days)" if partial else ""
    status = s.get("status")
    b = s["baseline"]
    median = b.get("median")
    ratio = s.get("ratio_to_median")
    unit = "VIIRS-equivalent hotspots" + (", corrected for cloud cover" if s.get("clouds", {}).get("mode") == "correct" else "")
    if status is None:
        verdict = f"{label}{so_far}: {s['value']:g} {unit}. Not enough past years to compare."
    else:
        times = f", {ratio:g} times a typical {MONTHS[m - 1]}" if ratio else ""
        verdict = f"{label}{so_far}: {s['value']:g} {unit}. That is {SAYS[status]}{times}."
    head = f"Fire alert: {place} is {SAYS.get(status, 'not comparable')} in {label}" if result["triggered"] \
        else f"No alert: {place} in {label}"
    lines = [
        verdict,
        f"Typical {MONTHS[m - 1]} ({b['years'][0]}–{b['years'][1]}, {b.get('n_years', 0)} years): "
        f"median {median if median is not None else '—'}, z {s.get('z') if s.get('z') is not None else '—'}, "
        f"rank {s.get('rank') or '—'}.",
    ]
    if s.get("cloud_fraction") is not None:
        lines.append(f"Cloud cover this month: {round(s['cloud_fraction'] * 100)}% "
                     f"({'simulated' if s.get('clouds', {}).get('source') == 'mock' else s.get('clouds', {}).get('source')}).")
    lines += [
        f"You get this when the month is at least {SAYS[threshold]}.",
        f"Open the calendar: {SITE}/explore",
        "",
        "Demo: Almatafi doesn't send emails yet. This is what the alert would say.",
        "Hotspots are satellite detections of heat, not confirmed fires. Fire data: NASA FIRMS.",
    ]
    e = html.escape
    rows = "".join(f"<p style=\"margin:0 0 10px\">{e(ln)}</p>" for ln in lines if ln)
    body_html = (
        "<!doctype html><html><body style=\"margin:0;background:#0b0d12;color:#ece6dc;"
        "font:15px/1.5 -apple-system,Segoe UI,Arial,sans-serif\">"
        "<div style=\"max-width:560px;margin:0 auto;padding:28px 22px\">"
        "<div style=\"font-weight:700;letter-spacing:.02em;color:#f2a65a;margin-bottom:14px\">Almatafi</div>"
        f"<h1 style=\"font-size:22px;line-height:1.25;margin:0 0 16px\">{e(head)}</h1>{rows}</div></body></html>")
    return {"subject": head, "text": "\n".join(lines) + "\n", "html": body_html}


@router.post("/alerts/preview")
def preview(body: PreviewRequest, request: Request):
    result = evaluate(request, body.aoi, body.threshold, body.clouds)
    email = render(result, body.name, body.threshold)
    s = result["stats"]
    return {"month": result["month"], "triggered": result["triggered"], "threshold": body.threshold,
            "status": s.get("status"), "value": s.get("value"), "z": s.get("z"),
            "partial": s.get("partial"), "email": email, "sent": False,
            "note": "Demo: no email is sent and nothing is stored.", "meta": s["meta"]}


# --- Local subscriptions and outbox (CLI only; never exposed over HTTP) ---------------------

def _load(path: Path) -> list[dict]:
    return json.loads(path.read_text())["subscriptions"] if path.exists() else []


def _save(path: Path, subs: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps({"subscriptions": subs}, indent=2) + "\n")
    tmp.replace(path)


def run(client: "TestClient", subs: list[dict], outbox: Path, now: datetime | None = None) -> list[Path]:
    """Check every subscription; write each triggered alert as an .eml file. Returns the files."""
    now = now or datetime.now(timezone.utc)
    outbox.mkdir(parents=True, exist_ok=True)
    written = []
    for sub in subs:
        r = client.post("/api/alerts/preview", json={"aoi": sub["aoi"], "name": sub.get("name"),
                                                      "threshold": sub.get("threshold", "above_normal")})
        if r.status_code != 200:
            print(f"{sub['id']}: HTTP {r.status_code} {r.json().get('error', {}).get('message', '')}", file=sys.stderr)
            continue
        d = r.json()
        if not d["triggered"]:
            print(f"{sub['id']}: {d['month']} is {d['status']}, below the threshold; nothing written")
            continue
        msg = EmailMessage()
        msg["From"], msg["To"], msg["Subject"] = FROM, sub["email"], d["email"]["subject"]
        msg["Date"] = now.strftime("%a, %d %b %Y %H:%M:%S +0000")
        msg["X-Almatafi-Demo"] = "not sent"
        msg.set_content(d["email"]["text"])
        msg.add_alternative(d["email"]["html"], subtype="html")
        path = outbox / f"{now.strftime('%Y%m%dT%H%M%SZ')}_{sub['id']}_{d['month']}.eml"
        path.write_bytes(bytes(msg))
        written.append(path)
        print(f"{sub['id']}: {d['month']} is {d['status']} → {path} (not sent)")
    return written


def main(argv=None) -> int:
    from fastapi.testclient import TestClient

    from app.config import Settings
    from app.main import create_app

    ap = argparse.ArgumentParser(description="Scratch alerts: local subscriptions, .eml outbox, no sending.")
    ap.add_argument("--data", type=Path, default=None, help="data folder (default: ALMATAFI_DATA_DIR)")
    ap.add_argument("--today", type=date.fromisoformat, default=None)
    sub = ap.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("add", help="add a local subscription")
    a.add_argument("--email", required=True)
    a.add_argument("--region", help="a demo region id, e.g. nile-delta")
    a.add_argument("--bbox", help="west,south,east,north")
    a.add_argument("--name", default=None)
    a.add_argument("--threshold", choices=list(Threshold.__args__), default="above_normal")
    sub.add_parser("list", help="show local subscriptions")
    sub.add_parser("run", help="check every subscription and write triggered alerts to the outbox")
    args = ap.parse_args(argv)
    settings = Settings(data_dir=args.data or Settings().data_dir, today=args.today)
    folder = settings.data_dir / "alerts"
    subs_path = folder / "subscriptions.json"
    subs = _load(subs_path)
    if args.cmd == "add":
        if bool(args.region) == bool(args.bbox):
            ap.error("give exactly one of --region or --bbox")
        aoi = ({"type": "region", "region_id": args.region} if args.region else
               {"type": "bbox", "bbox": [float(v) for v in args.bbox.split(",")]})
        subs.append({"id": uuid.uuid4().hex[:8], "email": args.email, "aoi": aoi,
                     "name": args.name or args.region, "threshold": args.threshold})
        _save(subs_path, subs)
        print(f"added {subs[-1]['id']} ({len(subs)} local subscriptions in {subs_path})")
    elif args.cmd == "list":
        for s in subs:
            print(f"{s['id']}  {s['email']}  {s.get('name') or s['aoi']}  ≥ {s['threshold']}")
    else:
        run(TestClient(create_app(settings)), subs, folder / "outbox")
    return 0


if __name__ == "__main__":
    sys.exit(main())
