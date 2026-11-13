# Higgsfield shots (X15)

`shots.json` is every generated still and clip: id, model, prompt, estimated cost. `gen.py` makes the missing ones into `out/` (gitignored) and refuses to pass a $5 total; `process.sh` turns `out/` into `frontend/public/media/`.

```
set -a; . <file with HF_KEY=id:secret>; set +a
python gen.py            # every shot not generated yet (or: python gen.py v_dive)
./process.sh             # WebP frame sequences, loops, stills
```

Spend on 2026-11-03: $1.42 (8 Soul Cinema stills, 1 Kling 3.0 Pro first/last-frame dive, 3 Kling 2.5 Turbo Pro loops). Models used: `higgsfield-ai/soul/cinema` (stills), `kling-video/v3.0/pro/image-to-video` (dive, first and last frame), `kling-video/v2.5-turbo/pro/image-to-video` (loops).

X27 (Nov 13): one more Soul still, `clouds_fire` ($0.01, for the Method page's cloud section); the ledger would then be $3.22. Generate it with `python gen.py clouds_fire`, then `./process.sh`. The Method page shows it only once `frontend/public/media/clouds-fire.webp` exists.

X33 (Nov 13): two more Soul stills for the game's end screens, `game_win` and `game_lose` ($0.01 each). With `clouds_fire` that makes $0.03 not yet generated, so the ledger would reach $3.24 of the $5 cap. `python gen.py clouds_fire game_win game_lose && ./process.sh`. The pages use them once the WebPs exist and fall back to existing stills before that.

X36 (Nov 13): the game's stage is drawn over a Higgsfield street plate, from Khalid's mockup: `game_street` (16:9) and `game_street_tall` (9:16 for phones), $0.01 each. `python gen.py game_street game_street_tall && ./process.sh` writes `frontend/public/media/game-street.webp` and `game-street-tall.webp`; the game uses them once they exist and draws its SVG street until then. The plate must have an empty sidewalk along the bottom ~8 % of the frame (the characters stand on it) and nothing in the middle (the card and the blocks go there).
