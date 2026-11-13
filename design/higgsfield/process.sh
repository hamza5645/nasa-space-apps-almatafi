#!/bin/sh
# Turns the Higgsfield outputs (out/) into the site's media (frontend/public/media/).
#   dive/   the orbit-to-field descent, 61 WebP frames for scroll scrubbing
#   smoke/  the flight through the smoke into the light, 61 WebP frames
#   *-loop.mp4 + posters   short seamless loops for the case-study cards
#   stills  WebP stills for cards and portraits
set -e
cd "$(dirname "$0")"
OUT=../../frontend/public/media
mkdir -p "$OUT/dive" "$OUT/smoke"
TMP=$(mktemp -d)

frames() { # clip name width
  rm -f "$TMP"/*.png
  ffmpeg -loglevel error -y -i "out/$1.mp4" -vf "select='not(mod(n\,2))',scale=$3:-2:flags=lanczos" -vsync vfr "$TMP/%03d.png"
  for f in "$TMP"/*.png; do
    n=$(basename "$f" .png)
    cwebp -quiet -q 58 -m 6 "$f" -o "$OUT/$2/$n.webp"
  done
}
frames v_dive dive 1600
frames v_smoke_clear smoke 1600

loop() { # clip name : 4.2 s loop, the last 0.8 s crossfades into the start
  ffmpeg -loglevel error -y -i "out/$1.mp4" -filter_complex \
    "[0]trim=0:5,setpts=PTS-STARTPTS,scale=1600:-2:flags=lanczos,split[a][b];[a]trim=0.8:5,setpts=PTS-STARTPTS[main];[b]trim=0:0.8,setpts=PTS-STARTPTS[head];[main][head]xfade=transition=fade:duration=0.8:offset=3.4,format=yuv420p[v]" \
    -map "[v]" -an -c:v libx264 -preset slow -crf 27 -movflags +faststart "$OUT/$2-loop.mp4"
  ffmpeg -loglevel error -y -ss 0.8 -i "out/$1.mp4" -frames:v 1 -vf scale=1600:-2 "$TMP/poster.png"
  cwebp -quiet -q 70 "$TMP/poster.png" -o "$OUT/$2-poster.webp"
}
loop v_rio_loop rio-negro
loop v_delta_loop nile-delta

still() { # image name width
  ffmpeg -loglevel error -y -i "out/$1.jpg" -vf "scale=$3:-2:flags=lanczos" "$TMP/s.png"
  cwebp -quiet -q 72 -m 6 "$TMP/s.png" -o "$OUT/$2.webp"
}
still delta_high delta-high 1600
still night_orbit night-orbit 1920
still who_responder who-responder 720
still who_scientist who-scientist 720
still who_farmer who-farmer 720
still rio_negro rio-negro 1600
still delta_low nile-delta 1600
[ -f out/clouds_fire.jpg ] && still clouds_fire clouds-fire 1600   # X27: Method page, clouds hide fires
[ -f out/game_win.jpg ] && still game_win game-win 1600     # X33: the game's end screen, embers left
[ -f out/game_lose.jpg ] && still game_lose game-lose 1600   # X33: the game's end screen, out of embers
[ -f out/game_street.jpg ] && still game_street game-street 1920   # X36: the game's night street behind every question
[ -f out/game_street_tall.jpg ] && still game_street_tall game-street-tall 1080   # X36: the same for phones

rm -rf "$TMP"
du -sh "$OUT" "$OUT/dive" "$OUT/smoke"
