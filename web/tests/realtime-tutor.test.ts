import test from "node:test";
import assert from "node:assert/strict";

import {
  base64ToPcm16,
  floatToPcm16,
  pcm16ToBase64,
  pcm16ToFloat32,
  resample,
} from "../lib/realtime-tutor";

test("realtime audio helpers preserve compact PCM16 samples", () => {
  const pcm = floatToPcm16(new Float32Array([-1, -0.5, 0, 0.5, 1]));
  assert.deepEqual(Array.from(pcm), [-32768, -16384, 0, 16383, 32767]);
  assert.deepEqual(Array.from(base64ToPcm16(pcm16ToBase64(pcm))), Array.from(pcm));
  assert.equal(pcm16ToFloat32(pcm)[2], 0);
});

test("realtime input audio is resampled to the configured capture rate", () => {
  const original = new Float32Array([0, 1, 0, -1]);
  const output = resample(original, 48_000, 16_000);
  assert.equal(output.length, 1);
  assert.equal(output[0], 0);
});
