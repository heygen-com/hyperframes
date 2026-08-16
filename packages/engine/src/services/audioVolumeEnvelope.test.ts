import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getFfmpegBinary } from "../utils/ffmpegBinaries.js";
import { applyVolumeEnvelopeToWav } from "./audioVolumeEnvelope.js";

const SAMPLE_RATE = 48000;
const CHANNELS = 2;
const HAS_FFMPEG = spawnSync(getFfmpegBinary(), ["-version"], { encoding: "utf-8" }).status === 0;

/** Build a PCM s16le stereo WAV whose every sample equals `value`. */
function writeConstantWav(path: string, frames: number, value: number): void {
  const bytesPerSample = 2;
  const dataSize = frames * CHANNELS * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(CHANNELS, 22);
  buffer.writeUInt32LE(SAMPLE_RATE, 24);
  buffer.writeUInt32LE(SAMPLE_RATE * CHANNELS * bytesPerSample, 28);
  buffer.writeUInt16LE(CHANNELS * bytesPerSample, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < frames * CHANNELS; i += 1) buffer.writeInt16LE(value, 44 + i * 2);
  writeFileSync(path, buffer);
}

function sampleAt(path: string, frame: number, channel = 0): number {
  const buffer = readFileSync(path);
  return buffer.readInt16LE(44 + (frame * CHANNELS + channel) * 2);
}

describe("applyVolumeEnvelopeToWav", () => {
  const dirs: string[] = [];
  const tmp = () => {
    const d = mkdtempSync(join(tmpdir(), "hf-env-"));
    dirs.push(d);
    return d;
  };
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it("applies a linear fade sample-accurately", () => {
    const path = join(tmp(), "a.wav");
    const frames = SAMPLE_RATE; // 1 second
    writeConstantWav(path, frames, 10000);

    // Fade 0 -> 1 over the full second.
    const applied = applyVolumeEnvelopeToWav(
      path,
      [
        { time: 0, volume: 0 },
        { time: 1, volume: 1 },
      ],
      0,
      0,
    );
    expect(applied).toBe(true);

    expect(sampleAt(path, 0)).toBe(0); // gain 0
    expect(sampleAt(path, frames / 2)).toBeCloseTo(5000, -2); // gain ~0.5
    expect(sampleAt(path, frames - 1)).toBeGreaterThan(9900); // gain ~1
  });

  it("offsets keyframes by the track start (composition time -> track-relative)", () => {
    const path = join(tmp(), "b.wav");
    const frames = SAMPLE_RATE;
    writeConstantWav(path, frames, 10000);

    // Track starts at 5s; the fade runs from comp-time 5s..6s -> wav 0s..1s.
    applyVolumeEnvelopeToWav(
      path,
      [
        { time: 5, volume: 0 },
        { time: 6, volume: 1 },
      ],
      5,
      0,
    );

    expect(sampleAt(path, 0)).toBe(0);
    expect(sampleAt(path, frames / 2)).toBeCloseTo(5000, -2);
  });

  it("holds base volume before the first keyframe and the last value after", () => {
    const path = join(tmp(), "c.wav");
    const frames = SAMPLE_RATE * 3; // 3 seconds
    writeConstantWav(path, frames, 10000);

    // Base 0.8 held until a fade-out begins at 2s.
    applyVolumeEnvelopeToWav(
      path,
      [
        { time: 2, volume: 0.8 },
        { time: 3, volume: 0 },
      ],
      0,
      0.8,
    );

    expect(sampleAt(path, SAMPLE_RATE)).toBeCloseTo(8000, -2); // 1s: base 0.8
    expect(sampleAt(path, frames - 1)).toBeLessThan(200); // 3s: faded to ~0
  });

  it("handles thousands of keyframes without failing (no expression ceiling)", () => {
    const path = join(tmp(), "d.wav");
    const frames = SAMPLE_RATE * 2;
    writeConstantWav(path, frames, 10000);

    const keyframes = Array.from({ length: 5000 }, (_, i) => ({
      time: (i / 4999) * 2,
      volume: Math.abs(Math.sin(i / 50)),
    }));
    expect(applyVolumeEnvelopeToWav(path, keyframes, 0, 0)).toBe(true);
  });

  it("parses chunks in any order (data before fmt)", () => {
    const path = join(tmp(), "order.wav");
    const frames = 4;
    const dataSize = frames * CHANNELS * 2;
    // Lay the data chunk before fmt to exercise order-independent scanning.
    const buffer = Buffer.alloc(12 + (8 + dataSize) + (8 + 16));
    buffer.write("RIFF", 0, "ascii");
    buffer.writeUInt32LE(buffer.length - 8, 4);
    buffer.write("WAVE", 8, "ascii");
    let o = 12;
    buffer.write("data", o, "ascii");
    buffer.writeUInt32LE(dataSize, o + 4);
    for (let i = 0; i < frames * CHANNELS; i += 1) buffer.writeInt16LE(10000, o + 8 + i * 2);
    o += 8 + dataSize;
    buffer.write("fmt ", o, "ascii");
    buffer.writeUInt32LE(16, o + 4);
    buffer.writeUInt16LE(1, o + 8);
    buffer.writeUInt16LE(CHANNELS, o + 10);
    buffer.writeUInt32LE(SAMPLE_RATE, o + 12);
    buffer.writeUInt16LE(16, o + 22);
    writeFileSync(path, buffer);

    expect(applyVolumeEnvelopeToWav(path, [{ time: 0, volume: 0 }], 0, 0)).toBe(true);
    expect(readFileSync(path).readInt16LE(12 + 8)).toBe(0); // first sample muted
  });

  it("rejects non-16-bit PCM so the caller can fall back", () => {
    const path = join(tmp(), "e.wav");
    // 24-bit PCM header (bitsPerSample = 24); body contents are irrelevant.
    const buffer = Buffer.alloc(44);
    buffer.write("RIFF", 0, "ascii");
    buffer.write("WAVE", 8, "ascii");
    buffer.write("fmt ", 12, "ascii");
    buffer.writeUInt32LE(16, 16);
    buffer.writeUInt16LE(1, 20);
    buffer.writeUInt16LE(CHANNELS, 22);
    buffer.writeUInt32LE(SAMPLE_RATE, 24);
    buffer.writeUInt16LE(24, 34);
    buffer.write("data", 36, "ascii");
    buffer.writeUInt32LE(0, 40);
    writeFileSync(path, buffer);

    expect(
      applyVolumeEnvelopeToWav(
        path,
        [
          { time: 0, volume: 0 },
          { time: 1, volume: 1 },
        ],
        0,
        0,
      ),
    ).toBe(false);
  });

  // The group sub-mix writes float precisely so an over-unity member sum keeps
  // its headroom until the group's own fader and FX act on it. If the baker
  // could not read that file it returned false, and the group's automation was
  // dropped on the floor by the caller.
  describe("32-bit float input", () => {
    /** Stereo float32 WAV, every sample `value` — over 1.0 on purpose. */
    function writeConstantFloatWav(path: string, frames: number, value: number): void {
      const dataSize = frames * CHANNELS * 4;
      const buffer = Buffer.alloc(44 + dataSize);
      buffer.write("RIFF", 0, "ascii");
      buffer.writeUInt32LE(36 + dataSize, 4);
      buffer.write("WAVE", 8, "ascii");
      buffer.write("fmt ", 12, "ascii");
      buffer.writeUInt32LE(16, 16);
      buffer.writeUInt16LE(3, 20); // WAVE_FORMAT_IEEE_FLOAT
      buffer.writeUInt16LE(CHANNELS, 22);
      buffer.writeUInt32LE(SAMPLE_RATE, 24);
      buffer.writeUInt32LE(SAMPLE_RATE * CHANNELS * 4, 28);
      buffer.writeUInt16LE(CHANNELS * 4, 32);
      buffer.writeUInt16LE(32, 34);
      buffer.write("data", 36, "ascii");
      buffer.writeUInt32LE(dataSize, 40);
      for (let i = 0; i < frames * CHANNELS; i += 1) buffer.writeFloatLE(value, 44 + i * 4);
      writeFileSync(path, buffer);
    }

    const floatSampleAt = (path: string, frame: number, channel = 0): number =>
      readFileSync(path).readFloatLE(44 + (frame * CHANNELS + channel) * 4);

    it("scales float samples and keeps them above 1.0 unclamped", () => {
      const path = join(tmp(), "float.wav");
      writeConstantFloatWav(path, SAMPLE_RATE, 1.4);

      expect(
        applyVolumeEnvelopeToWav(
          path,
          [
            { time: 0, volume: 1 },
            { time: 1, volume: 1 },
          ],
          0,
          1,
        ),
      ).toBe(true);

      // Unity envelope: unchanged, and NOT clamped down to 1.0.
      expect(floatSampleAt(path, 0)).toBeCloseTo(1.4, 5);
      expect(floatSampleAt(path, SAMPLE_RATE - 1)).toBeCloseTo(1.4, 5);
    });

    it("applies the envelope across the file", () => {
      const path = join(tmp(), "float-fade.wav");
      writeConstantFloatWav(path, SAMPLE_RATE, 1.4);

      expect(
        applyVolumeEnvelopeToWav(
          path,
          [
            { time: 0, volume: 1 },
            { time: 1, volume: 0 },
          ],
          0,
          1,
        ),
      ).toBe(true);

      expect(floatSampleAt(path, 0)).toBeCloseTo(1.4, 5);
      expect(floatSampleAt(path, Math.floor(SAMPLE_RATE / 2))).toBeCloseTo(0.7, 2);
      expect(floatSampleAt(path, SAMPLE_RATE - 1)).toBeCloseTo(0, 3);
    });

    /**
     * The fixtures above are hand-built canonical 44-byte headers, which is NOT
     * what the group sub-mix actually hands this function: ffmpeg's `pcm_f32le`
     * writes an 18-byte `fmt ` chunk plus a `fact` chunk, putting `data` at
     * offset 92. Every assertion above would still pass if this function could
     * not read a real one — and an unreadable file returns false, which the
     * caller reads as "no automation here" and drops the group's envelope.
     */
    it.skipIf(!HAS_FFMPEG)("reads what ffmpeg actually writes, not just a canonical header", () => {
      const path = join(tmp(), "ffmpeg-f32.wav");
      const made = spawnSync(
        getFfmpegBinary(),
        [
          "-nostdin",
          "-v",
          "error",
          "-f",
          "lavfi",
          "-i",
          "aevalsrc=0.5*sin(2*PI*440*t)|0.5*sin(2*PI*440*t):d=1:s=48000",
          "-acodec",
          "pcm_f32le",
          "-ar",
          "48000",
          path,
        ],
        { encoding: "utf-8" },
      );
      expect(made.status).toBe(0);

      const before = readFileSync(path);
      // The format tag is the load-bearing part; the chunk LAYOUT is this
      // build's quirk, so it is logged as context rather than required — a
      // build emitting a canonical 16-byte fmt with data at 44 is legal and
      // handled, and pinning 18/92 would fail on the good case.
      expect(before.readUInt16LE(20)).toBe(3); // WAVE_FORMAT_IEEE_FLOAT

      expect(
        applyVolumeEnvelopeToWav(
          path,
          [
            { time: 0, volume: 1 },
            { time: 1, volume: 0 },
          ],
          0,
          1,
        ),
      ).toBe(true);

      // Locate `data` the way the parser does, then check the fade landed.
      let at = 12;
      let dataOffset = -1;
      const after = readFileSync(path);
      while (at + 8 <= after.length) {
        const id = after.toString("ascii", at, at + 4);
        const size = after.readUInt32LE(at + 4);
        if (id === "data") {
          dataOffset = at + 8;
          break;
        }
        at += 8 + size + (size % 2);
      }
      expect(dataOffset).toBeGreaterThan(0);
      // Faded to silence by the end (stereo float = 8 bytes per frame). This is
      // the assertion that matters: the parser read a real file and the bake
      // landed, whatever chunk layout the build chose.
      expect(Math.abs(after.readFloatLE(dataOffset + (SAMPLE_RATE - 2) * 8))).toBeLessThan(0.02);
    });
  });
});
