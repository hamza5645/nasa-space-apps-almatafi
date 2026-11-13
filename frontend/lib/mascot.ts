// X33: the game's host. Until Khalid's sprite sheets arrive, the game draws its own ember
// (components/game/Mascot.tsx). To use a sprite sheet, put the PNG/WebP in public/game/ and
// describe it here; nothing else changes.
//
// A sheet is a grid of equal frames: one row per mood, frames left to right. Example for a
// 6-column, 5-row sheet of 256×256 frames:
//
//   export const MASCOT: SpriteSheet = {
//     src: "/game/mascot.webp", frameW: 256, frameH: 256, cols: 6, rows: 5, scale: 0.5,
//     moods: {
//       idle: { row: 0, frames: 6, fps: 8 },          // waiting for an answer (loops)
//       happy: { row: 1, frames: 6, fps: 12 },        // right answer
//       sad: { row: 2, frames: 6, fps: 10 },          // wrong answer
//       win: { row: 3, frames: 6, fps: 10 },          // end of the game, embers left
//       out: { row: 4, frames: 6, fps: 8, loop: false },  // out of embers (stops on the last frame)
//     },
//   };
//
// A mood the sheet doesn't have falls back to idle.

export type Mood = "idle" | "happy" | "sad" | "win" | "out";

export type SpriteSheet = {
  src: string;
  frameW: number;
  frameH: number;
  cols: number;
  rows: number;
  scale?: number;
  moods: Partial<Record<Mood, { row: number; frames: number; fps: number; loop?: boolean }>> & { idle: { row: number; frames: number; fps: number } };
};

export const MASCOT: SpriteSheet | null = null;
