import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { readWav } from "./wav.js";
import { encodeWav } from "./wav.test-helpers.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "hf-wav-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));
const file = (name: string, bytes: Buffer) => {
  writeFileSync(join(dir, name), bytes);
  return join(dir, name);
};

it("reads a 16-bit mono WAV's samples and rate in JS", () => {
  const wav = readWav(file("a.wav", encodeWav([0, 0.5, -0.5, -1], 16_000)));
  expect(wav.sampleRate).toBe(16_000);
  expect([...wav.samples]).toEqual([0, 0.5, -0.5, -1]);
});

it("reads a WAV with no samples as silence, as ffmpeg writes for empty audio", () => {
  expect(readWav(file("empty.wav", encodeWav([], 16_000))).samples).toHaveLength(0);
});

it("names a file that is not a 16-bit mono WAV", () => {
  const stereo = encodeWav([0, 0], 16_000);
  stereo.writeUInt16LE(2, 22);
  expect(() => readWav(file("text.wav", Buffer.from("not audio")))).toThrow(
    "text.wav is not a 16-bit mono PCM WAV",
  );
  expect(() => readWav(file("stereo.wav", stereo))).toThrow("is not a 16-bit mono PCM WAV");
});
