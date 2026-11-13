#!/usr/bin/env python3
"""Cut the game's pixel-art sprite sheets into registered animation strips.

    python3 design/sprites/process.py [--src DIR] [--out DIR] [--qa DIR]

Reads the five source sheets (default: design/sprites/source/), writes one
horizontal strip per animation (lossless WebP with alpha) plus sprites.json to
frontend/public/game/sprites/. With --qa it also writes a contact sheet and a
GIF per animation (frames on mid grey, baseline and centre lines drawn).

Needs only Pillow and numpy. Rerunning gives the same files.

Steps, per sheet:
  1. Clean alpha: drop the near-invisible matte (alpha < 14), any baked
     white/grey background reachable from the transparent outside, the stray
     selection-outline curves and white leg-gap slivers baked into the host
     sheet, the explorer sheet's red square, and specks. The explorer's fold
     arrows, which the source left fully transparent, are restored.
  2. Find the frames: rows from the y projection, frames from the x projection
     of the solid shapes, merging small detached pieces (sparks, smoke, shake
     marks) into their nearest frame until each row has its known count.
  3. Defringe: semi-transparent pixels on the outer edge (between the
     transparent outside and the opaque outline) take the colour of the
     nearest opaque pixel, which removes white and red matte halos. Real fire
     colours are left alone.
  4. Register, per animation: the body (opaque, minus fire, smoke, water,
     hose and shadows) gives the feet line and the horizontal centre (lower
     body; the head for side-on running). Grounded frames put their feet on
     one baseline; in jumps and the run, frames in the air keep their height
     above the row's ground line from the source sheet. Smoke-only frames sit
     on the baseline; see-through "reforming" frames slide onto the solid
     frame they become. Near-static loops are refined by matching the lower
     body to the first frame. Every frame goes on one canvas, body centre at
     frameW / 2.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent

ALPHA_FLOOR = 14  # below this the source is matte noise (red halos, specks)
OPAQUE = 230  # at or above this a pixel counts as solid
PAD = 3  # transparent margin around the union of all frames

# --------------------------------------------------------------------------
# Sources and animations (the animation names are a contract with the game)
# --------------------------------------------------------------------------

SHEETS = {
    "host": dict(
        file="host-panic-run-celebrate.png",
        rows=[13, 14, 14],
        effects=("fire", "smoke"),
        # opaque white slivers left between the legs by the background removal
        gap_lines=True,
    ),
    "explorer": dict(
        file="explorer-map-fold.png",
        rows=[8, 8],
        # stray solid red square, top right of row 1 frame 8 (colour-keyed)
        kill_red=[(1860, 30, 1926, 106)],
        # the curved "fold" arrows (row 1 frames 3-4, row 2 frame 4) are drawn
        # in the RGB but the source's background removal made them fully
        # transparent; bring them back with an outline
        restore_marks=[(640, 145, 725, 215), (885, 165, 960, 235), (725, 480, 795, 545)],
    ),
    "firefighter": dict(
        file="firefighter-spray.png",
        rows=[8, 8],
        effects=("water", "hose"),
    ),
    "runner": dict(file="khalid-run.png", rows=[8]),
    "jumper": dict(file="khalid-jump.png", rows=[8], effects=("shadow",)),
    # X34: a campfire-style flame (the charts' flames) and the ALMATAFI truck (decor).
    "fire": dict(file="fire.png", rows=[8, 8]),
    "truck": dict(file="truck.png", rows=[4, 4]),
}

# Frames are (row, index) in the sheet, 0-based.
#   air:    frames whose feet are more than AIR_TOL px above the row's ground
#           line keep their source height (jumps, the run's flight phase);
#           every other frame stands on the baseline.
#   jump:   also report "rise" (px the feet rise at the top) and "peak" (frame).
#   refine: near-static loops: nudge each frame so its lower body overlaps
#           frame 0 best (removes the generator's 1-3 px wobble).
#   anchor: horizontal centre: "legs" (lower 30 % of the body, default) or
#           "head" (top 20 %; for side-on running, where legs swing).
#   modes:  per-frame overrides {(row, i): (anchor, mask)}; mask "content" uses
#           everything visible instead of the opaque body (ghost/smoke frames).
#   align:  {(row, i): (row, j)}: slide a see-through ghost frame sideways onto
#           the solid frame it turns into.
HOST_RUN = {(0, i): ("head", "body") for i in range(7, 13)} | {(1, 0): ("head", "body")}
HOST_SMOKE = {(1, 1): ("head", "content")} | {
    (1, i): ("legs", "content") for i in range(2, 9)
}
ANIMS = {
    "host-idle": dict(
        sheet="host",
        # calm hands-in-pockets frames from the end of row 2 and both ends of
        # row 3, ordered for the smallest change between neighbours. (1, 13)
        # is left out: its head is drawn differently and pops in the loop.
        frames=[(2, 11), (2, 12), (2, 13), (2, 0), (1, 12)],
        fps=6,
        facing="front",
        refine=True,
        band=0.5,
    ),
    "host-wrong": dict(
        sheet="host",
        frames=[(0, i) for i in range(13)] + [(1, i) for i in range(14)],
        fps=12,
        facing="right",
        modes=HOST_RUN | HOST_SMOKE,
        align={(1, 7): (1, 9), (1, 8): (1, 9)},
    ),
    "host-right": dict(
        sheet="host",
        frames=[(2, i) for i in range(14)],
        fps=12,
        facing="front",
        air=True,
        jump=True,
    ),
    "explorer-fold": dict(
        sheet="explorer", frames=[(0, i) for i in range(8)], fps=10,
        facing="front", refine=True, band=0.4,
    ),
    "explorer-unfold": dict(
        sheet="explorer", frames=[(1, i) for i in range(8)], fps=10,
        facing="front", refine=True, band=0.4,
    ),
    "firefighter-spray": dict(
        sheet="firefighter",
        frames=[(r, i) for r in range(2) for i in range(8)],
        fps=12,
        facing="right",
        refine=True,
        band=0.4,
    ),
    "khalid-run": dict(
        sheet="runner", frames=[(0, i) for i in range(8)], fps=14,
        facing="right", air=True, anchor="head",
    ),
    "khalid-jump": dict(
        sheet="jumper", frames=[(0, i) for i in range(8)], fps=14,
        facing="front", air=True, jump=True,
    ),
    # The flame is all "effect" colours, so every frame anchors on its visible content.
    "fire-loop": dict(
        sheet="fire", frames=[(r, i) for r in range(2) for i in range(8)], fps=10,
        facing="front", modes={(r, i): ("legs", "content") for r in range(2) for i in range(8)},
    ),
    # The chart's flame: only the tall frames, so a flame's height can stand for a number
    # and the loop is a flicker, not a swell.
    "fire-chart": dict(
        sheet="fire", frames=[(0, 3), (0, 4), (0, 5), (0, 6), (0, 7), (1, 7), (1, 6), (1, 5)], fps=9,
        facing="front", modes={(r, i): ("legs", "content") for r in range(2) for i in range(8)},
    ),
    "truck-idle": dict(
        sheet="truck", frames=[(r, i) for r in range(2) for i in range(4)], fps=6,
        facing="right", refine=True, band=0.5,
    ),
}
AIR_TOL = 10

# --------------------------------------------------------------------------
# Small binary-image helpers (numpy only)
# --------------------------------------------------------------------------


def dilate(m: np.ndarray, r: int = 1) -> np.ndarray:
    if r <= 0:
        return m.copy()
    h, w = m.shape
    p = np.pad(m, r)
    out = np.zeros_like(m)
    for dy in range(2 * r + 1):
        for dx in range(2 * r + 1):
            out |= p[dy:dy + h, dx:dx + w]
    return out


def erode(m: np.ndarray, r: int = 1) -> np.ndarray:
    return ~dilate(~m, r)


def opening(m: np.ndarray, r: int = 1) -> np.ndarray:
    return dilate(erode(m, r), r)


def label(mask: np.ndarray) -> tuple[np.ndarray, int]:
    """8-connected components by run-length union-find. Returns (labels, n)."""
    h, w = mask.shape
    parent = [0]

    def find(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    prev: list[tuple[int, int, int]] = []
    runs: list[tuple[int, int, int, int]] = []
    pad = np.zeros(w + 2, np.int8)
    for y in range(h):
        pad[1:-1] = mask[y]
        d = np.diff(pad)
        starts = np.flatnonzero(d == 1).tolist()
        ends = (np.flatnonzero(d == -1) - 1).tolist()
        cur = []
        j = 0
        for x0, x1 in zip(starts, ends):
            rid = None
            while j < len(prev) and prev[j][1] < x0 - 1:
                j += 1
            k = j
            while k < len(prev) and prev[k][0] <= x1 + 1:
                a = find(prev[k][2])
                if rid is None:
                    rid = a
                elif a != rid:
                    lo, hi = min(a, rid), max(a, rid)
                    parent[hi] = lo
                    rid = lo
                k += 1
            if rid is None:
                rid = len(parent)
                parent.append(rid)
            cur.append((x0, x1, rid))
            runs.append((y, x0, x1, rid))
        prev = cur
    lab = np.zeros((h, w), np.int32)
    remap: dict[int, int] = {}
    for y, x0, x1, rid in runs:
        r = find(rid)
        if r not in remap:
            remap[r] = len(remap) + 1
        lab[y, x0:x1 + 1] = remap[r]
    return lab, len(remap)


def components(mask: np.ndarray):
    """Yield (label_array, n, areas, bboxes) for a mask."""
    lab, n = label(mask)
    areas = np.bincount(lab.ravel(), minlength=n + 1)
    return lab, n, areas


def segments(occupied: np.ndarray, weight: np.ndarray) -> list[list[int]]:
    """Runs of True in a 1-D array as [start, end, mass]."""
    out, s = [], None
    for i, v in enumerate(occupied.tolist() + [False]):
        if v and s is None:
            s = i
        elif not v and s is not None:
            out.append([s, i - 1, int(weight[s:i].sum())])
            s = None
    return out


def merge_to(segs: list[list[int]], n: int) -> list[list[int]]:
    """Merge the lightest segment into its nearest neighbour until n remain."""
    segs = [list(s) for s in segs]
    while len(segs) > n:
        i = min(range(len(segs)), key=lambda k: segs[k][2])
        gl = segs[i][0] - segs[i - 1][1] if i > 0 else 10**9
        gr = segs[i + 1][0] - segs[i][1] if i < len(segs) - 1 else 10**9
        j = i - 1 if gl <= gr else i + 1
        a, b = sorted((i, j))
        segs[a] = [segs[a][0], segs[b][1], segs[a][2] + segs[b][2]]
        del segs[b]
    if len(segs) < n:
        raise SystemExit(f"found {len(segs)} frames, expected {n}")
    return segs


def windows(segs: list[list[int]], size: int) -> list[tuple[int, int]]:
    """Split [0, size) at the middle of each gap between segments."""
    cuts = [0]
    for a, b in zip(segs, segs[1:]):
        cuts.append((a[1] + b[0]) // 2 + 1)
    cuts.append(size)
    return list(zip(cuts[:-1], cuts[1:]))


# --------------------------------------------------------------------------
# Colour classes
# --------------------------------------------------------------------------


def hsv(rgb: np.ndarray):
    r, g, b = (rgb[..., i].astype(np.float32) for i in range(3))
    mx = np.maximum(np.maximum(r, g), b)
    mn = np.minimum(np.minimum(r, g), b)
    sat = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1), 0)
    d = np.maximum(mx - mn, 1e-6)
    hue = np.where(
        mx == r, ((g - b) / d) % 6, np.where(mx == g, (b - r) / d + 2, (r - g) / d + 4)
    ) * 60.0
    return hue, sat, mx


def effect_mask(rgb: np.ndarray, kinds) -> np.ndarray:
    """Pixels that are effects, not body: fire, smoke, water, hose, shadow."""
    hue, sat, val = hsv(rgb)
    r, g, b = (rgb[..., i].astype(np.int32) for i in range(3))
    m = np.zeros(rgb.shape[:2], bool)
    if "fire" in kinds:
        m |= (hue <= 58) & (sat >= 0.55) & (val >= 190)
    if "smoke" in kinds:
        m |= (sat < 0.2) & (val >= 80) & (val <= 200)
    if "water" in kinds:
        m |= (b > r + 25) & (b >= 150)
    if "hose" in kinds:
        m |= (r > g + 60) & (r > b + 45)
    if "shadow" in kinds:
        m |= (np.maximum(np.maximum(r, g), b) - np.minimum(np.minimum(r, g), b) < 32) & (
            (r + g + b) / 3 > 85
        ) & ((r + g + b) / 3 < 185)
    return m


def fire_colour(rgb: np.ndarray) -> np.ndarray:
    hue, sat, val = hsv(rgb)
    return ((hue <= 60) | (hue >= 345)) & (sat >= 0.45) & (val >= 150)


# --------------------------------------------------------------------------
# Cleaning
# --------------------------------------------------------------------------


def clean_sheet(a: np.ndarray, cfg: dict) -> np.ndarray:
    """Alpha clean-up on the whole sheet. `a` is int32 RGBA, edited in place."""
    rgb, al = a[..., :3], a[..., 3]

    # 0. sheet-specific junk (the explorer sheet's red square)
    for x0, y0, x1, y1 in cfg.get("kill_red", []):
        sub = a[y0:y1, x0:x1]
        red = (sub[..., 0] > 150) & (sub[..., 1] < 80) & (sub[..., 2] < 80)
        sub[..., 3][red] = 0

    # 1. matte noise
    al[al < ALPHA_FLOOR] = 0

    # 2. baked background: flood from the transparent outside over light,
    #    unsaturated pixels only (eyes, glints, shirts sit behind an outline)
    lo = np.minimum(np.minimum(rgb[..., 0], rgb[..., 1]), rgb[..., 2])
    hi = np.maximum(np.maximum(rgb[..., 0], rgb[..., 1]), rgb[..., 2])
    light = (al > 0) & (hi - lo <= 8) & (lo >= 170)
    seen = al == 0
    removed = np.zeros_like(seen)
    for _ in range(400):
        grow = dilate(seen, 1) & light & ~removed
        if not grow.any():
            break
        removed |= grow
        seen |= grow
    al[removed] = 0

    # 3. stray thin curves (selection outlines baked into the host sheet).
    #    a) faint pixels on a 1-px line: at most 3 visible neighbours
    for _ in range(2):
        m = al > 0
        p = np.pad(m, 1).astype(np.int8)
        hh, ww = m.shape
        nb = sum(
            p[dy:dy + hh, dx:dx + ww] for dy in range(3) for dx in range(3)
            if (dy, dx) != (1, 1)
        )
        al[m & (al < 140) & (nb <= 3)] = 0
    #    b) long, thin, faint pieces that are not part of any solid shape
    m = al > 0
    core = opening(m, 1)
    thin = m & ~dilate(core, 1)
    lab, n, areas = components(thin)
    if n:
        idx = np.flatnonzero(lab.ravel())
        labs = lab.ravel()[idx]
        ys, xs = np.divmod(idx, lab.shape[1])
        x0 = np.full(n + 1, 10**9)
        x1 = np.full(n + 1, -1)
        y0 = np.full(n + 1, 10**9)
        y1 = np.full(n + 1, -1)
        np.minimum.at(x0, labs, xs)
        np.maximum.at(x1, labs, xs)
        np.minimum.at(y0, labs, ys)
        np.maximum.at(y1, labs, ys)
        asum = np.bincount(labs, weights=al.ravel()[idx], minlength=n + 1)
        length = np.maximum(x1 - x0, y1 - y0) + 1
        mean_a = asum / np.maximum(areas, 1)
        stray = (length >= 24) & (areas / np.maximum(length, 1) < 3.2) & (mean_a < 190)
        stray[0] = False
        al[stray[lab]] = 0

    # 4. opaque white slivers of background left between the legs: thin,
    #    long, light and unsaturated (eye whites and glints are short blobs)
    if cfg.get("gap_lines"):
        sliver = (al >= 120) & (hi - lo <= 24) & (lo >= 140)
        lab, n, areas = components(sliver)
        if n:
            idx = np.flatnonzero(lab.ravel())
            labs = lab.ravel()[idx]
            ys, xs = np.divmod(idx, lab.shape[1])
            ext = np.zeros((4, n + 1), np.int64)
            ext[0] = 10**9
            ext[2] = 10**9
            np.minimum.at(ext[0], labs, xs)
            np.maximum.at(ext[1], labs, xs)
            np.minimum.at(ext[2], labs, ys)
            np.maximum.at(ext[3], labs, ys)
            length = np.maximum(ext[1] - ext[0], ext[3] - ext[2]) + 1
            bad = (length >= 12) & (areas / np.maximum(length, 1) <= 3.5)
            bad[0] = False
            al[bad[lab]] = 0

    # 5. specks: tiny isolated bits
    m = al > 0
    lab, n, areas = components(m)
    tiny = areas <= 6
    tiny[0] = False
    al[tiny[lab]] = 0

    # 6. marks lost to the source's background removal: white fill that is
    #    fully transparent, plus its dark outline ring
    for x0, y0, x1, y1 in cfg.get("restore_marks", []):
        sub = a[y0:y1, x0:x1]
        sal = sub[..., 3]
        srgb = sub[..., :3]
        fill = (sal == 0) & (srgb.min(-1) > 200)
        lab, n, areas = components(fill)
        if not n:
            continue
        fill = lab == int(np.argmax(areas[1:]) + 1)
        ring = dilate(fill, 3) & ~fill & (sal == 0)
        dark = ring & (srgb.max(-1) < 90)
        srgb[ring & ~dark] = (24, 16, 12)  # noisy matte pixels: outline colour
        sal[fill | ring] = 255
    return a


def defringe(a: np.ndarray, keep_fire: bool) -> None:
    """Recolour the semi-transparent outer edge from the nearest opaque pixel."""
    al = a[..., 3]
    out = al == 0
    solid = al >= OPAQUE
    edge = (al > 0) & ~solid & dilate(out, 2) & dilate(solid, 2)
    if keep_fire:
        edge &= ~fire_colour(a[..., :3])
    if not edge.any():
        return
    # push opaque colours outward, two rings
    col = a[..., :3].astype(np.float32) * solid[..., None]
    have = solid.copy()
    h, w = al.shape
    for _ in range(2):
        acc = np.zeros((h, w, 3), np.float32)
        cnt = np.zeros((h, w), np.float32)
        pc = np.pad(col, ((1, 1), (1, 1), (0, 0)))
        ph = np.pad(have, 1)
        for dy in range(3):
            for dx in range(3):
                hv = ph[dy:dy + h, dx:dx + w]
                acc += pc[dy:dy + h, dx:dx + w] * hv[..., None]
                cnt += hv
        new = ~have & (cnt > 0)
        col[new] = acc[new] / cnt[new][:, None]
        have |= new
    fix = edge & have
    a[..., :3][fix] = np.round(col[fix]).astype(np.int32)


# --------------------------------------------------------------------------
# Frames
# --------------------------------------------------------------------------


class Frame:
    def __init__(self, rgba: np.ndarray, x: int, y: int, effects=()):
        self.rgba = rgba  # cropped to content, int32
        self.x, self.y = x, y  # top-left in the sheet
        al = rgba[..., 3]
        body = (al >= 200) & ~effect_mask(rgba[..., :3], effects)
        body = opening(body, 1)
        lab, n, areas = components(body)
        if n:
            big = int(np.argmax(areas[1:]) + 1)
            # keep the main piece and anything at least a fifth of its size
            keep = areas >= max(areas[big] * 0.2, 60)
            keep[0] = False
            body = keep[lab]
        self.has_body = bool(n) and body.sum() > 1500
        self.content = al >= 40
        self.body = body if self.has_body else self.content
        self.set_mode("legs", "body")

    def set_mode(self, anchor: str, mask: str) -> None:
        """Choose what the feet line and the horizontal centre are measured on."""
        m = self.content if mask == "content" else self.body
        ys, xs = np.nonzero(m)
        self.mask = m
        self.top, self.bottom = int(ys.min()), int(ys.max())
        hgt = self.bottom - self.top + 1
        if anchor == "head":
            sel = ys <= self.top + 0.2 * hgt
        else:
            sel = ys >= self.bottom - 0.3 * hgt
        lo, hi = np.percentile(xs[sel], [5, 95])
        self.anchor_x = float(lo + hi) / 2.0

    @property
    def sheet_bottom(self) -> int:
        return self.y + self.bottom


def cut_frames(a: np.ndarray, cfg: dict) -> list[list[Frame]]:
    al = a[..., 3]
    core = opening(al >= 24, 1)
    h, w = al.shape
    py = core.sum(1)
    rows = merge_to(segments(py > 3, py), len(cfg["rows"]))
    out = []
    for (ry0, ry1), n in zip(windows(rows, h), cfg["rows"]):
        band = core[ry0:ry1]
        px = band.sum(0)
        segs = merge_to(segments(px > 0, px), n)
        row = []
        for x0, x1 in windows(segs, w):
            sub = a[ry0:ry1, x0:x1]
            m = sub[..., 3] > 0
            ys, xs = np.nonzero(m)
            cy0, cy1, cx0, cx1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
            crop = sub[cy0:cy1, cx0:cx1].copy()
            row.append(Frame(crop, x0 + cx0, ry0 + cy0, cfg.get("effects", ())))
        out.append(row)
    return out


# --------------------------------------------------------------------------
# Registration
# --------------------------------------------------------------------------


def ground_line(row: list[Frame]) -> float:
    bottoms = np.array([f.sheet_bottom for f in row if f.has_body])
    near = bottoms[bottoms >= bottoms.max() - 12]
    return float(np.median(near))


def match(f: Frame, ref: Frame, band: float, sx: int, sy: int, metric: str = "iou"):
    """Best integer (dx, dy) to add to f's placement (anchor on the centre line,
    feet on the baseline) so its lower body overlaps ref's, placed the same way.
    metric "iou" for look-alike frames, "cover" (share of ref covered) when f
    carries extra smoke around the same body."""
    margin = max(sx, sy) + 2
    W = 2 * max(f.rgba.shape[1], ref.rgba.shape[1]) + 2 * margin
    H = 2 * max(f.rgba.shape[0], ref.rgba.shape[0]) + 2 * margin

    def placed(fr: Frame, dx: int, dy: int) -> np.ndarray:
        m = np.zeros((H, W), bool)
        hgt = fr.bottom - fr.top + 1
        sub = fr.mask.copy()
        sub[: int(fr.bottom - band * hgt)] = False
        ox = int(round(W / 2 - fr.anchor_x)) + dx
        oy = int(round(H / 2 - fr.bottom)) + dy
        h, w = sub.shape
        m[oy:oy + h, ox:ox + w] = sub
        return m

    r = placed(ref, 0, 0)
    rsum = max(int(r.sum()), 1)
    best, arg = -1e9, (0, 0)
    for dy in range(-sy, sy + 1):
        for dx in range(-sx, sx + 1):
            m = placed(f, dx, dy)
            inter = int((m & r).sum())
            score = inter / max(int((m | r).sum()), 1) if metric == "iou" else inter / rsum
            score -= 1e-4 * (abs(dx) + abs(dy))  # prefer small shifts on ties
            if score > best:
                best, arg = score, (dx, dy)
    return arg


def build(name: str, spec: dict, sheet_frames: list[list[Frame]]):
    frames = [sheet_frames[r][i] for r, i in spec["frames"]]
    rows_used = sorted({r for r, _ in spec["frames"]})
    # ground line of each row: feet of its standing frames, body masks
    for row in sheet_frames:
        for f in row:
            f.set_mode("legs", "body")
    grounds = {r: ground_line(sheet_frames[r]) for r in rows_used}
    modes = spec.get("modes", {})
    for key, f in zip(spec["frames"], frames):
        f.set_mode(*modes.get(key, (spec.get("anchor", "legs"), "body")))
    # pos[i] = (x, y) of the frame's crop origin relative to (centre, baseline)
    pos = []
    lifts = []
    for (r, i), f in zip(spec["frames"], frames):
        g = grounds[r]
        lift = g - f.sheet_bottom  # >0 when the feet are above the ground
        if spec.get("air") and lift > AIR_TOL:
            # in the air: keep the source height above the row's ground line
            y = f.y - g - 1
        else:
            y = -(f.bottom + 1)  # feet on the baseline
            lift = 0.0
        pos.append([-f.anchor_x, float(y)])
        lifts.append(lift)
    if spec.get("refine"):
        for i in range(1, len(frames)):
            dx, dy = match(frames[i], frames[0], spec.get("band", 0.4), 6, 2)
            pos[i][0] += dx
            pos[i][1] += dy
    for key, ref_key in spec.get("align", {}).items():
        # ghost frames: slide sideways onto the solid frame they turn into
        i, j = spec["frames"].index(key), spec["frames"].index(ref_key)
        ref = frames[j]
        adj = pos[j][0] + ref.anchor_x
        dx, _ = match(frames[i], ref, 0.5, 48, 0, metric="cover")
        pos[i][0] += dx + adj
    pos = [[int(round(x)), int(round(y))] for x, y in pos]

    left = max(-x for x, _ in pos)
    right = max(x + f.rgba.shape[1] for (x, _), f in zip(pos, frames))
    up = max(-y for _, y in pos)
    down = max(y + f.rgba.shape[0] for (_, y), f in zip(pos, frames))
    half = max(left, right) + PAD
    fw = 2 * half
    fh = up + max(down, 0) + 2 * PAD
    baseline = up + PAD
    strip = np.zeros((fh, fw * len(frames), 4), np.uint8)
    for k, ((x, y), f) in enumerate(zip(pos, frames)):
        ox, oy = k * fw + half + x, baseline + y
        h, w = f.rgba.shape[:2]
        strip[oy:oy + h, ox:ox + w] = f.rgba.astype(np.uint8)
    meta = {
        "src": f"/game/sprites/{name}.webp",
        "frameW": fw,
        "frameH": fh,
        "frames": len(frames),
        "fps": spec["fps"],
        "baseline": baseline,
        "facing": spec["facing"],
    }
    if spec.get("jump"):
        peak = int(np.argmax(lifts))
        meta["rise"] = int(round(lifts[peak]))
        meta["peak"] = peak
    return strip, meta


# --------------------------------------------------------------------------
# QA
# --------------------------------------------------------------------------


def qa(name: str, strip: np.ndarray, meta: dict, qa_dir: Path) -> None:
    fw, fh, n, base = meta["frameW"], meta["frameH"], meta["frames"], meta["baseline"]
    grey = (118, 118, 118, 255)
    cols = min(n, 7)
    rows = (n + cols - 1) // cols
    gap = 6
    sheet = Image.new("RGBA", (cols * (fw + gap) + gap, rows * (fh + gap + 14) + gap), (40, 40, 40, 255))
    d = ImageDraw.Draw(sheet)
    gif = []
    for k in range(n):
        tile = Image.new("RGBA", (fw, fh), grey)
        fr = Image.fromarray(strip[:, k * fw:(k + 1) * fw])
        tile.alpha_composite(fr)
        g = tile.copy()
        td = ImageDraw.Draw(tile)
        td.line([(0, base), (fw, base)], fill=(0, 255, 255, 255))
        td.line([(fw // 2, 0), (fw // 2, fh)], fill=(255, 0, 255, 255))
        cx, cy = gap + (k % cols) * (fw + gap), gap + (k // cols) * (fh + gap + 14)
        sheet.paste(tile, (cx, cy + 14))
        d.text((cx + 2, cy + 1), str(k), fill=(255, 255, 255, 255))
        gd = ImageDraw.Draw(g)
        gd.line([(0, base), (fw, base)], fill=(0, 200, 200, 255))
        gd.line([(fw // 2, base - 6), (fw // 2, base + 6)], fill=(255, 0, 255, 255))
        gif.append(g.convert("RGB"))
    sheet.save(qa_dir / f"{name}-contact.png")
    gif[0].save(
        qa_dir / f"{name}.gif", save_all=True, append_images=gif[1:],
        duration=int(1000 / meta["fps"]), loop=0, disposal=1,
    )
    # onion skin: every frame at low opacity, to see registration drift
    acc = np.zeros((fh, fw, 3), np.float32)
    for k in range(n):
        tile = Image.new("RGBA", (fw, fh), grey)
        tile.alpha_composite(Image.fromarray(strip[:, k * fw:(k + 1) * fw]))
        acc += np.asarray(tile.convert("RGB"), np.float32)
    onion = Image.fromarray((acc / n).astype(np.uint8))
    od = ImageDraw.Draw(onion)
    od.line([(0, base), (fw, base)], fill=(0, 255, 255))
    od.line([(fw // 2, 0), (fw // 2, fh)], fill=(255, 0, 255))
    onion.save(qa_dir / f"{name}-onion.png")


# --------------------------------------------------------------------------


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--src", type=Path, default=HERE / "source")
    ap.add_argument("--out", type=Path, default=REPO / "frontend/public/game/sprites")
    ap.add_argument("--qa", type=Path, default=None)
    args = ap.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    if args.qa:
        args.qa.mkdir(parents=True, exist_ok=True)

    cut: dict[str, list[list[Frame]]] = {}
    for key, cfg in SHEETS.items():
        a = np.asarray(Image.open(args.src / cfg["file"]).convert("RGBA")).astype(np.int32).copy()
        clean_sheet(a, cfg)
        defringe(a, keep_fire="fire" in cfg.get("effects", ()))
        al = a[..., 3]
        al[al >= OPAQUE] = 255
        cut[key] = cut_frames(a, cfg)

    meta_all = {}
    for name, spec in ANIMS.items():
        strip, meta = build(name, spec, cut[spec["sheet"]])
        Image.fromarray(strip).save(
            args.out / f"{name}.webp", "WEBP", lossless=True, quality=100, method=6
        )
        meta_all[name] = meta
        if args.qa:
            qa(name, strip, meta, args.qa)
        extra = f" rise={meta['rise']} peak={meta['peak']}" if "rise" in meta else ""
        print(f"{name:18s} {meta['frames']:2d} x {meta['frameW']}x{meta['frameH']} "
              f"baseline={meta['baseline']}{extra}")
    (args.out / "sprites.json").write_text(json.dumps(meta_all, indent=2) + "\n")


if __name__ == "__main__":
    main()
