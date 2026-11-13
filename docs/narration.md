# Narration script (X33)

One voice line per landing chapter and short reactions for the game. Off by default on the site; the speaker button turns it on. Read back to back, the 8 landing lines (about 77 words) are also the 30-second video's voice-over.

**Recording:** a phone voice memo in a quiet room is fine. One file per line, named as below, as `.mp3`, with no long silence at the start or end. Put them in `frontend/public/audio/` and list the ids in `VOICE` in `frontend/lib/sound.ts`; until then nothing is requested.

## Landing (scroll story)

| File | Chapter on screen | Line |
|---|---|---|
| `n0` | Hero: "Is this fire season normal?" | Is this fire season normal? |
| `n1` | One week, the whole planet | In one week, satellites spotted three hundred thousand hotspots. |
| `n2` | MODIS, 1 km pixels | Since 2000, MODIS has watched with one-kilometre pixels. |
| `n3` | VIIRS, 375 m pixels | In 2012, VIIRS joined: sharper eyes, five times more hotspots. |
| `n4` | The 2012 jump | Glue them together, and fire seems to explode. It didn't. |
| `n5` | The Nile Delta | In the Nile Delta, farmers burn rice straw every autumn. |
| `n6` | The dive from orbit | Almatafi turns both satellites into one record, from orbit to the field. |
| `n7` | Closing | Pick any place. See its fire history. Know when a season isn't normal. |

If the video runs long, drop `n2`.

## Game ("Normal or not?", `/play`)

The questions change every game (they're built from the data), so they stay on screen; the voice only reacts.

| File | When | Line |
|---|---|---|
| `game-intro` | Start | Can you tell a normal fire season from a strange one? Seven questions, three embers. |
| `right-1` | Right answer | Right. That's how you read a fire season. |
| `right-2` | Right answer | Spot on. |
| `wrong-1` | Wrong answer | Not this time. Look at the dots. |
| `wrong-2` | Wrong answer | Careful, that's the trap. |
| `last-ember` | One ember left | One ember left. |
| `win` | End, embers left | You read fire data like an analyst. Now try your own place. |
| `lose` | Out of embers | Out of embers. Every trap you hit is one you'll spot next time. |

The game already plays these when the files exist (`frontend/lib/sound.ts`, `say()`). The landing captions and voice are wired when the recordings arrive.
