import assert from "node:assert/strict";
import { test } from "node:test";
import { drawSequence, type Sequence } from "./sequence.ts";

const img = { naturalWidth: 16, naturalHeight: 9 } as HTMLImageElement;

test("drawSequence keeps the caller's globalAlpha, so the smoke can fade in and out", () => {
  const seq: Sequence = { frames: [img, img], loaded: [true, true] };
  const alphas: number[] = [];
  const ctx = { globalAlpha: 0.4, drawImage: () => alphas.push(ctx.globalAlpha) } as unknown as CanvasRenderingContext2D;
  assert.equal(drawSequence(ctx, seq, 0.5, 160, 90), true);
  // Frame 0 at the caller's alpha, frame 1 crossfaded on top at half of it.
  assert.deepEqual(alphas.map((a) => +a.toFixed(3)), [0.4, 0.2]);
  assert.equal(ctx.globalAlpha, 0.4);
});

test("drawSequence draws nothing until a frame is decoded", () => {
  const seq: Sequence = { frames: [img], loaded: [false] };
  const ctx = { globalAlpha: 1, drawImage: () => assert.fail("drew an undecoded frame") } as unknown as CanvasRenderingContext2D;
  assert.equal(drawSequence(ctx, seq, 0, 160, 90), false);
});
