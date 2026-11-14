#!/usr/bin/env python3
"""Generate the Higgsfield shots in shots.json -> out/<id>.<jpg|mp4>.

usage: python gen.py [shot_id ...]     (no ids = every shot not generated yet)

Each shot is {id, model, args, usd}. An image shot may name `from` (the id of an earlier
image to use as the first frame) and `last` (an image id for the last frame); those images are
uploaded and passed as image_url / last_image_url. Spend is logged in out/spend.json, and
nothing is submitted past BUDGET. Credentials come from the environment (HF_KEY=id:secret)
and are never printed.
"""
import json, os, subprocess, sys, time
from concurrent.futures import ThreadPoolExecutor

import higgsfield_client as hf

BUDGET = 7.58                                   # hard stop for this project ($5 until Nov 14; Khalid allowed $4 more on top of the $3.58 spent, for the promo video, X41)
W = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(W, "out"); os.makedirs(OUT, exist_ok=True)
SPEND = os.path.join(OUT, "spend.json")


def spent():
    return json.load(open(SPEND)) if os.path.exists(SPEND) else {"total": 0.0, "items": []}


def ext(s):
    return "mp4" if "video" in s["model"] or "hailuo" in s["model"] else "jpg"


def path(sid, e):
    return os.path.join(OUT, f"{sid}.{e}")


def upload(sid):
    """Public URL for an earlier image (cached in out/uploads.json)."""
    cache_p = os.path.join(OUT, "uploads.json")
    cache = json.load(open(cache_p)) if os.path.exists(cache_p) else {}
    if sid not in cache:
        small = os.path.join(OUT, f"{sid}.upload.jpg")       # 1920 px, q 88: big enough, quick to send
        subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", path(sid, "jpg"), "-vf", "scale='min(1920,iw)':-2",
                        "-q:v", "3", small], check=True)
        for attempt in range(4):
            try:
                cache[sid] = hf.upload_file(small)
                break
            except Exception:
                if attempt == 3:
                    raise
                time.sleep(3 * (attempt + 1))
        json.dump(cache, open(cache_p, "w"), indent=1)
    return cache[sid]


def first_url(r):
    for k in ("images", "videos"):
        if r.get(k):
            return r[k][0].get("url")
    for k in ("image", "video"):
        if isinstance(r.get(k), dict):
            return r[k].get("url")
    return None


def run(s):
    args = dict(s["args"])
    if s.get("from"):
        args["image_url"] = upload(s["from"])
    if s.get("last"):
        args["last_image_url"] = upload(s["last"])
    args = {k: v for k, v in args.items() if v is not None}
    try:
        r = hf.subscribe(s["model"], arguments=args)
    except Exception as e:                       # failed / nsfw / cancelled are not charged
        return s["id"], "ERROR " + type(e).__name__ + ": " + str(e)[:300]
    url = first_url(r)
    if not url:
        return s["id"], "NO URL " + json.dumps(r)[:300]
    with open(os.path.join(OUT, "results.jsonl"), "a") as f:  # keep the URL even if the download fails
        f.write(json.dumps({"id": s["id"], "url": url, "t": time.time()}) + "\n")
    subprocess.run(["curl", "-sL", "--fail", "-o", path(s["id"], ext(s)), url], check=True)
    return s["id"], "OK " + path(s["id"], ext(s))


def main():
    shots = json.load(open(os.path.join(W, "shots.json")))
    want = sys.argv[1:]
    todo = [s for s in shots if s["id"] in want] if want else \
           [s for s in shots if not os.path.exists(path(s["id"], ext(s)))]
    sp = spent(); est = sum(s["usd"] for s in todo)
    print(f"{len(todo)} shots, est ${est:.2f}, spent so far ${sp['total']:.2f}", flush=True)
    if sp["total"] + est > BUDGET:
        sys.exit(f"refused: would exceed ${BUDGET:.2f}")
    # Shots that depend on another shot in this batch run after it.
    ids = {s["id"] for s in todo}
    waves = [[s for s in todo if not ({s.get("from"), s.get("last")} & ids)],
             [s for s in todo if {s.get("from"), s.get("last")} & ids]]
    for s in todo:
        for k in ("from", "last"):
            if s.get(k) and os.path.exists(path(s[k], "jpg")):
                upload(s[k])
    for wave in waves:
        with ThreadPoolExecutor(6) as ex:
            for sid, msg in ex.map(run, wave):
                s = next(x for x in wave if x["id"] == sid)
                if msg.startswith("OK"):
                    sp["total"] = round(sp["total"] + s["usd"], 4)
                    sp["items"].append({"id": sid, "model": s["model"], "usd": s["usd"], "t": time.strftime("%H:%M:%S")})
                    json.dump(sp, open(SPEND, "w"), indent=1)
                print(sid, msg, flush=True)
    print(f"spent ${sp['total']:.2f}", flush=True)


if __name__ == "__main__":
    main()
