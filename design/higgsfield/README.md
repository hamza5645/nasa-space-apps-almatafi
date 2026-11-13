# Higgsfield shots (X15)

`shots.json` is every generated still and clip: id, model, prompt, estimated cost. `gen.py` makes the missing ones into `out/` (gitignored) and refuses to pass a $5 total; `process.sh` turns `out/` into `frontend/public/media/`.

```
set -a; . <file with HF_KEY=id:secret>; set +a
python gen.py            # every shot not generated yet (or: python gen.py v_dive)
./process.sh             # WebP frame sequences, loops, stills
```

Spend on 2026-11-03: $1.42 (8 Soul Cinema stills, 1 Kling 3.0 Pro first/last-frame dive, 3 Kling 2.5 Turbo Pro loops). Models used: `higgsfield-ai/soul/cinema` (stills), `kling-video/v3.0/pro/image-to-video` (dive, first and last frame), `kling-video/v2.5-turbo/pro/image-to-video` (loops).
