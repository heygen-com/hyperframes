import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findFfBinary } from "@hyperframes/parsers/ff-binaries";
import {
  accumulatePeaks,
  buildPeakMapCacheKey,
  createPeakAccumulator,
  decodePeakMap,
  finishPeaks,
} from "./peakMap.js";

function stereo(frames: Array<[number, number]>): Buffer {
  const buf = Buffer.alloc(frames.length * 8);
  frames.forEach(([l, r], i) => {
    buf.writeFloatLE(l, i * 8);
    buf.writeFloatLE(r, i * 8 + 4);
  });
  return buf;
}

describe("peak accumulation", () => {
  it("keeps the absolute max of either channel per bin, un-normalized", () => {
    const acc = createPeakAccumulator(4, 0.5, 2);
    accumulatePeaks(
      acc,
      stereo([
        [0.1, -0.3],
        [0.2, 0],
        [0, 0.05],
        [-0.04, 0],
      ]),
    );
    expect(finishPeaks(acc)).toEqual([0.3, 0.05]);
  });

  it("carries a frame split across chunks", () => {
    const acc = createPeakAccumulator(2, 1, 2);
    const whole = stereo([
      [0.5, 0],
      [0, -0.9],
    ]);
    accumulatePeaks(acc, whole.subarray(0, 5));
    accumulatePeaks(acc, whole.subarray(5));
    expect(finishPeaks(acc)).toEqual([0.9]);
    expect(acc.frame).toBe(2);
  });
});

describe("peak accumulation, mono", () => {
  it("reads one channel per frame", () => {
    const acc = createPeakAccumulator(2, 1, 1);
    const buf = Buffer.alloc(8);
    buf.writeFloatLE(-1, 0);
    buf.writeFloatLE(0.5, 4);
    accumulatePeaks(acc, buf);
    expect(finishPeaks(acc)).toEqual([1]);
  });
});

describe("buildPeakMapCacheKey", () => {
  it("changes when the file is replaced and never collides with a waveform entry", () => {
    const a = buildPeakMapCacheKey("a/talk.mp4", { size: 10, mtimeMs: 1 });
    expect(a).toBe(buildPeakMapCacheKey("a/talk.mp4", { size: 10, mtimeMs: 1 }));
    expect(a).not.toBe(buildPeakMapCacheKey("a/talk.mp4", { size: 11, mtimeMs: 1 }));
    expect(a).not.toBe(buildPeakMapCacheKey("a/talk.mp4", { size: 10, mtimeMs: 2 }));
    expect(a).toMatch(/^peaks-v2_a_talk\.mp4_10-1\.json$/);
  });
});

describe("decodePeakMap", () => {
  const ffmpeg = findFfBinary("ffmpeg");
  it.skipIf(!ffmpeg)(
    "reads a 0 dBFS video track near 1.0 and a -12 dBFS one near 0.25",
    async () => {
      const dir = mkdtempSync(join(tmpdir(), "hf-peaks-"));
      try {
        const make = (name: string, volume: string) => {
          const file = join(dir, name);
          execFileSync(ffmpeg ?? "ffmpeg", [
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            "color=c=black:s=32x32:d=1",
            "-f",
            "lavfi",
            "-i",
            `sine=frequency=440:duration=1,volume=${volume}`,
            "-shortest",
            "-c:v",
            "libx264",
            "-c:a",
            "pcm_s16le",
            file,
          ]);
          return file;
        };
        const loud = await decodePeakMap(make("loud.mov", "8"));
        const quiet = await decodePeakMap(make("quiet.mov", "2"));
        expect(Math.max(...loud)).toBeGreaterThan(0.95);
        expect(Math.max(...quiet)).toBeLessThan(0.3);
        expect(loud.length).toBeGreaterThanOrEqual(19);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );

  it.skipIf(!ffmpeg)(
    "decodes the probed first audio stream when a louder stereo stream follows it",
    async () => {
      const dir = mkdtempSync(join(tmpdir(), "hf-peaks-"));
      try {
        const file = join(dir, "multi.mkv");
        execFileSync(ffmpeg ?? "ffmpeg", [
          "-v",
          "error",
          "-f",
          "lavfi",
          "-i",
          "aevalsrc=0.1*sin(2*PI*440*t):s=48000:d=1",
          "-f",
          "lavfi",
          "-i",
          "aevalsrc=0.9*sin(2*PI*440*t)|0.9*sin(2*PI*440*t):s=48000:d=1",
          "-map",
          "0:a",
          "-map",
          "1:a",
          "-c:a",
          "pcm_f32le",
          "-disposition:a",
          "0",
          file,
        ]);
        const peaks = await decodePeakMap(file);
        expect(peaks.length).toBeGreaterThanOrEqual(19);
        expect(peaks.length).toBeLessThanOrEqual(21);
        expect(Math.max(...peaks)).toBeCloseTo(0.1, 2);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );
});
