// X33: the game's sound effects, synthesized (no files) with the Web Audio API, and the
// recorded voice lines when they exist (public/audio/{id}.mp3, script in docs/narration.md). Off until the player turns it on; the choice is remembered on this device.

const KEY = "almatafi-sound";

export type Sfx = "tap" | "right" | "wrong" | "win" | "lose";

// Voice lines that have been recorded and put in public/audio/ (ids as in the narration script:
// n0…n7 for the landing, game-intro, right-1, right-2, wrong-1, wrong-2, last-ember, win, lose).
// Empty until the recordings arrive, so no request is made for a file that isn't there.
export const VOICE = new Set<string>([]);

let ctx: AudioContext | null = null;
let voice: HTMLAudioElement | null = null;

export function soundOn(): boolean {
  try { return localStorage.getItem(KEY) === "on"; } catch { return fallback; }
}

const listeners = new Set<() => void>();
let fallback = false; // when storage is unavailable, the choice lasts for this page

/** For useSyncExternalStore: the server and the first paint say "off". */
export function subscribeSound(cb: () => void) {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

export function setSoundOn(on: boolean) {
  fallback = on;
  try { localStorage.setItem(KEY, on ? "on" : "off"); } catch { /* private mode: just not remembered */ }
  if (!on) voice?.pause();
  listeners.forEach((l) => l());
}

function tone(freq: number, start: number, dur: number, type: OscillatorType, gain: number) {
  const c = ctx!, o = c.createOscillator(), g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, c.currentTime + start);
  g.gain.setValueAtTime(0.0001, c.currentTime + start);
  g.gain.exponentialRampToValueAtTime(gain, c.currentTime + start + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + start + dur);
  o.connect(g).connect(c.destination);
  o.start(c.currentTime + start);
  o.stop(c.currentTime + start + dur + 0.05);
}

export function play(s: Sfx) {
  if (!soundOn() || typeof window === "undefined") return;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    if (s === "tap") tone(660, 0, 0.08, "triangle", 0.08);
    if (s === "right") { tone(523, 0, 0.16, "sine", 0.18); tone(784, 0.1, 0.28, "sine", 0.16); }
    if (s === "wrong") { tone(196, 0, 0.3, "sawtooth", 0.07); tone(147, 0.12, 0.36, "sine", 0.12); }
    if (s === "win") [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.11, 0.3, "sine", 0.14));
    if (s === "lose") [392, 330, 262, 196].forEach((f, i) => tone(f, i * 0.14, 0.32, "triangle", 0.1));
  } catch { /* no audio: the game works without it */ }
}

/** A recorded voice line, if the file is there; quietly nothing otherwise. */
export function say(id: string) {
  if (!soundOn() || typeof window === "undefined" || !VOICE.has(id)) return;
  try {
    voice?.pause();
    voice = new Audio(`/audio/${id}.mp3`);
    voice.volume = 0.9;
    void voice.play().catch(() => {});
  } catch { /* no voice file yet */ }
}
