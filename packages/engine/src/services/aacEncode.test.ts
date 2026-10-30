import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { FFMPEG_PATH_ENV, getFfmpegBinary, getFfprobeBinary } from "../utils/ffmpegBinaries.js";
import { aacSegmentCount, encodeAac, splitAdtsFrames } from "./aacEncode.js";
import * as ffmpegRunner from "../utils/runFfmpeg.js";

const HAS_FFMPEG = spawnSync(getFfmpegBinary(), ["-version"], { encoding: "utf-8" }).status === 0;

function ffmpeg(args: string[]): Buffer {
  const result = spawnSync(getFfmpegBinary(), ["-nostdin", "-loglevel", "error", ...args], {
    maxBuffer: 1 << 28,
  });
  if (result.status !== 0) throw new Error(`ffmpeg failed: ${result.stderr?.toString()}`);
  return result.stdout;
}

function decode(path: string, filter = "anull"): Float32Array {
  const pcm = ffmpeg(["-i", path, "-af", filter, "-f", "f32le", "-ac", "2", "-"]);
  return new Float32Array(pcm.buffer, pcm.byteOffset, pcm.length / 4);
}

/** Where the audio stream says it ends, in 1/48000 s ticks. */
function streamEnd(path: string): string {
  const args = ["-v", "error", "-select_streams", "a", "-show_entries", "stream=duration_ts"];
  const result = spawnSync(getFfprobeBinary(), [...args, "-of", "csv=p=0", "--", path], {
    encoding: "utf-8",
  });
  return result.stdout.trim();
}

/** Join k decodes from segment k-1's last packet and segment k's first: samples [(cut-1)*1024, cut*1024). */
function joinCentres(seconds: number, segments: number): number[] {
  const packets = Math.ceil(Math.round(seconds * 48_000) / 1024) + 1;
  return Array.from({ length: segments - 1 }, (_, k) => {
    const cut = Math.round(((k + 1) * packets) / segments);
    return (cut - 1) * 1024 + 512;
  });
}

/** Error against the source: overall RMS, and the peak within 4096 frames of each cut versus elsewhere. */
function errorStats(source: Float32Array, coded: Float32Array, cutFrames: number[]) {
  const nearCut = (i: number) =>
    cutFrames.some((cut) => Math.abs(Math.floor(i / 2) - cut * 1024) < 4096);
  let sum = 0;
  let peakNearCut = 0;
  let peakElsewhere = 0;
  for (let i = 0; i < source.length; i++) {
    const error = Math.abs(coded[i]! - source[i]!);
    sum += error * error;
    if (nearCut(i)) peakNearCut = Math.max(peakNearCut, error);
    else peakElsewhere = Math.max(peakElsewhere, error);
  }
  return { rms: Math.sqrt(sum / source.length), peakNearCut, peakElsewhere };
}

/**
 * Half a second of stereo: a quiet noise floor from the first sample, then a sharp two-tone
 * onset. Shaped like a film whose sound opens softly; `seed` varies only the floor.
 */
function quietThenOnset(seed: number, f0: number): Float32Array {
  const n = 24_000;
  const onset = 2738;
  const channel = (phase: [number, number], peak: number) => {
    const tone = Array.from({ length: n }, (_, i) => {
      const t = Math.max(0, (i - onset) / 48_000);
      const envelope = Math.min(1, Math.max(0, (i - onset) / 27)) * Math.exp(-1.25 * t);
      const f = 2 * Math.PI * f0 * t;
      return envelope * (Math.sin(f + phase[0]) + 0.6 * Math.sin(2 * f + phase[1]));
    });
    const max = Math.max(...tone.map(Math.abs));
    return tone.map((v) => (peak * v) / max);
  };
  const left = channel([1, 0], 0.35 * 0.25);
  const right = channel([0.5, 2], 0.25);
  const out = new Float32Array(n * 2);
  let state = seed >>> 0;
  for (let i = 0; i < 2 * n; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const floor = (state / 2 ** 31 - 1) * 10 ** (-70 / 20) * Math.min(1, (i >> 1) / 1500);
    out[i] = (i % 2 ? right : left)[i >> 1]! + floor;
  }
  return out;
}

const peakOfFirst = (signal: Float32Array, frames: number) =>
  signal.subarray(0, frames * 2).reduce((peak, v) => Math.max(peak, Math.abs(v)), 0);

describe("aacSegmentCount", () => {
  it("keeps audio under two minutes in one encoder", () => {
    expect(aacSegmentCount(119)).toBe(1);
  });

  it("gives each segment at least a minute, up to eight segments", () => {
    expect(aacSegmentCount(180)).toBe(3);
    expect(aacSegmentCount(1800)).toBe(8);
  });
});

describe.skipIf(!HAS_FFMPEG)("encodeAac", () => {
  const dir = mkdtempSync(join(tmpdir(), "hf-aac-encode-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("uses identical scalar AAC arguments and output bytes on repeated encodes", async () => {
    const source = join(dir, "scalar.wav");
    ffmpeg([
      "-f",
      "lavfi",
      "-i",
      "anoisesrc=seed=2:amplitude=0.1:duration=0.5:sample_rate=48000",
      "-ac",
      "2",
      "-c:a",
      "pcm_f32le",
      source,
    ]);
    const first = join(dir, "scalar-first.m4a");
    const second = join(dir, "scalar-second.m4a");
    const run = vi.spyOn(ffmpegRunner, "runFfmpeg");
    try {
      expect((await encodeAac(source, first, 0.5, { timeout: 30_000 })).success).toBe(true);
      expect((await encodeAac(source, second, 0.5, { timeout: 30_000 })).success).toBe(true);
      const encoderCalls = run.mock.calls.filter(([args]) => args.includes("-acodec"));
      expect(encoderCalls).toHaveLength(2);
      for (const [args] of encoderCalls) {
        expect(args).toEqual([
          "-cpuflags",
          "0",
          "-i",
          source,
          "-af",
          "aresample=48000,adelay=delays=480256S:all=1",
          "-acodec",
          "aac",
          "-b:a",
          "192k",
          "-f",
          "adts",
          "-y",
          expect.stringMatching(/[/\\]0\.aac$/),
        ]);
      }
      expect(readFileSync(first).equals(readFileSync(second))).toBe(true);
      const muxCalls = run.mock.calls.filter(([args]) => args.includes("-bsf:a"));
      expect(muxCalls).toHaveLength(2);
      for (const [args] of muxCalls) expect(args).not.toContain("-cpuflags");
    } finally {
      run.mockRestore();
    }
  });

  it("encodes a long mix in parallel segments that decode like one encoder's output", async () => {
    const source = join(dir, "mix.wav");
    ffmpeg([
      ...["-f", "lavfi", "-i", "anoisesrc=d=150.5:c=pink:r=48000:a=0.2:seed=1"],
      ...["-f", "lavfi", "-i", "sine=f=330:d=150.5:r=48000"],
      ...["-filter_complex", "[0][1]amix=2:normalize=0,aformat=channel_layouts=stereo"],
      ...["-c:a", "pcm_f32le", "-y", source],
    ]);
    const single = join(dir, "single.m4a");
    const split = join(dir, "split.m4a");
    ffmpeg(["-i", source, "-t", "150.5", "-acodec", "aac", "-b:a", "192k", "-y", single]);
    expect((await encodeAac(source, split, 150.5, { timeout: 120_000 })).success).toBe(true);
    // 150.5 s is not a whole number of AAC frames, so the last packet is short.
    expect(streamEnd(split)).toBe(streamEnd(single));

    const packets = (path: string) =>
      splitAdtsFrames(ffmpeg(["-i", path, "-c", "copy", "-f", "adts", "-"]));
    const singlePackets = packets(single);
    const splitPackets = packets(split);
    expect(splitPackets.length).toBe(singlePackets.length);
    expect(Buffer.concat(splitPackets).equals(Buffer.concat(singlePackets))).toBe(false);

    const reference = decode(source);
    const singleDecoded = decode(single);
    const splitDecoded = decode(split);
    expect(splitDecoded.length).toBe(singleDecoded.length);
    const cuts = [Math.round(singlePackets.length / 2)];
    const singleError = errorStats(reference, singleDecoded, cuts);
    const splitError = errorStats(reference, splitDecoded, cuts);
    // Measured: under 1% more RMS error, and cut peaks at one encoder's own level.
    expect(splitError.rms).toBeLessThan(singleError.rms * 1.02);
    expect(splitError.peakNearCut).toBeLessThan(singleError.peakElsewhere);
  }, 120_000);

  it("encodes a frame-aligned duration whose sample count is not exact in floating point", async () => {
    // 147.52 s is exactly 6915 AAC frames, but 147.52 * 48000 lands one ulp above it.
    const source = join(dir, "aligned.wav");
    ffmpeg(["-f", "lavfi", "-i", "sine=f=440:d=147.52:r=48000", "-ac", "2", "-y", source]);
    const single = join(dir, "aligned-single.m4a");
    const split = join(dir, "aligned-split.m4a");
    ffmpeg(["-i", source, "-t", "147.52", "-acodec", "aac", "-b:a", "192k", "-y", single]);
    expect((await encodeAac(source, split, 147.52, { timeout: 120_000 })).success).toBe(true);
    expect(streamEnd(split)).toBe(streamEnd(single));
  }, 120_000);

  it.skipIf(process.platform === "win32")(
    "ends the stream at the duration on an FFmpeg whose setts has no duration option",
    async () => {
      const source = join(dir, "old-ffmpeg.wav");
      ffmpeg(["-f", "lavfi", "-i", "sine=f=440:d=2.5:r=48000", "-ac", "2", "-y", source]);
      const wrapper = join(dir, "ffmpeg-without-setts-duration");
      writeFileSync(
        wrapper,
        [
          "#!/bin/sh",
          'case "$*" in *"-h bsf=setts"*) exit 0;; esac',
          `case "$*" in *"setts=duration"*) echo "Option 'duration' not found" >&2; exit 1;; esac`,
          `exec "${getFfmpegBinary()}" "$@"`,
        ].join("\n"),
        { mode: 0o755 },
      );
      const reference = join(dir, "old-ffmpeg-reference.m4a");
      expect((await encodeAac(source, reference, 2.5, { timeout: 30_000 })).success).toBe(true);

      const saved = process.env[FFMPEG_PATH_ENV];
      process.env[FFMPEG_PATH_ENV] = wrapper;
      const coded = join(dir, "old-ffmpeg.m4a");
      try {
        expect((await encodeAac(source, coded, 2.5, { timeout: 30_000 })).success).toBe(true);
      } finally {
        if (saved === undefined) delete process.env[FFMPEG_PATH_ENV];
        else process.env[FFMPEG_PATH_ENV] = saved;
      }
      expect(streamEnd(coded)).toBe(streamEnd(reference));
    },
    60_000,
  );

  it("keeps a sharp onset at its level when the audio opens quietly, encode after encode", async () => {
    const growthDb: number[] = [];
    for (const f0 of [250, 306, 360]) {
      for (let seed = 1; seed <= 12; seed++) {
        const raw = join(dir, "onset.f32");
        writeFileSync(raw, quietThenOnset(seed, f0));
        const source = join(dir, "onset.wav");
        ffmpeg(["-f", "f32le", "-ar", "48000", "-ac", "2", "-i", raw, "-y", source]);
        let input = source;
        for (const generation of [1, 2]) {
          const coded = join(dir, `onset-${generation}.m4a`);
          expect((await encodeAac(input, coded, 0.5, { timeout: 60_000 })).success).toBe(true);
          input = join(dir, `onset-${generation}.wav`);
          ffmpeg(["-i", coded, "-c:a", "pcm_f32le", "-y", input]);
        }
        const before = peakOfFirst(decode(source), 4800);
        growthDb.push(20 * Math.log10(peakOfFirst(decode(input), 4800) / before));
      }
    }
    // Measured on ffmpeg 7.0.2 and 8.0.1: at most +0.1 dB. Opening cold, 3 of these grew 2.7-3.3 dB.
    const report = growthDb.map((db) => db.toFixed(2)).join(" ");
    expect(Math.max(...growthDb), `peak growth per signal, dB: ${report}`).toBeLessThan(1);
  }, 120_000);

  it("keeps a tempo-changed 44.1 kHz track at lag 0 against the same filter uncoded", async () => {
    const source = join(dir, "rate.wav");
    ffmpeg([
      "-f",
      "lavfi",
      "-i",
      "anoisesrc=d=6:c=pink:r=44100:a=0.3:seed=1",
      "-ac",
      "2",
      "-y",
      source,
    ]);
    const output = join(dir, "rate.m4a");
    const encoded = await encodeAac(source, output, 4, { timeout: 60_000, filter: "atempo=1.5" });
    expect(encoded.success).toBe(true);

    const mono = (stereo: Float32Array) =>
      Float32Array.from(
        { length: stereo.length / 2 },
        (_, i) => stereo[2 * i]! + stereo[2 * i + 1]!,
      );
    const reference = mono(decode(source, "atempo=1.5,aresample=48000"));
    const coded = mono(decode(output));
    const correlationAt = (lag: number) => {
      let [dot, rr, cc] = [0, 0, 0];
      for (let i = 72_000; i < 96_000; i++) {
        const [r, c] = [reference[i]!, coded[i + lag] ?? 0];
        [dot, rr, cc] = [dot + r * c, rr + r * r, cc + c * c];
      }
      return dot / Math.sqrt(rr * cc);
    };
    const scores = Array.from({ length: 4097 }, (_, k) => correlationAt(k - 2048));
    expect(scores.indexOf(Math.max(...scores)) - 2048).toBe(0);
    expect(correlationAt(0)).toBeGreaterThan(0.95);
  }, 60_000);

  it("leaves no click at the joins of a pure tone", async () => {
    const source = join(dir, "tone.wav");
    ffmpeg([
      ...["-f", "lavfi", "-i", "sine=f=440:d=150.5:r=48000"],
      ...["-af", "volume=0.5,aformat=channel_layouts=stereo", "-c:a", "pcm_f32le", "-y", source],
    ]);
    const output = join(dir, "tone.m4a");
    expect((await encodeAac(source, output, 150.5, { timeout: 120_000 })).success).toBe(true);

    const joins = joinCentres(150.5, aacSegmentCount(150.5));
    expect(joins).toHaveLength(1);
    const window = 2 * 2400; // 50 ms of interleaved stereo
    const peakAt = (signal: Float32Array, frame: number) => {
      let peak = 0;
      for (let i = Math.max(0, frame * 2 - window / 2); i < frame * 2 + window / 2; i++) {
        peak = Math.max(peak, Math.abs(signal[i] ?? 0));
      }
      return peak;
    };
    const medianPeak = (signal: Float32Array) => {
      const peaks = Array.from({ length: Math.floor(signal.length / window) }, (_, w) =>
        peakAt(signal, w * (window / 2) + window / 4),
      ).sort((a, b) => a - b);
      return peaks[Math.floor(peaks.length / 2)]!;
    };
    // A 440 Hz tone has almost nothing above 2 kHz, so a click shows as a broadband spike there;
    // a dropped or repeated frame shows as a phase jump against the source.
    const highPassed = decode(output, Array(4).fill("highpass=f=2000").join(","));
    const reference = decode(source);
    const residual = decode(output).map((sample, i) => sample - (reference[i] ?? 0));
    const [hpMedian, residualMedian] = [medianPeak(highPassed), medianPeak(residual)];
    // Measured: joins sit at the median; the source's own stream-copy joins read about 40 dB above it.
    for (const centre of joins) {
      expect(peakAt(highPassed, centre)).toBeLessThan(hpMedian * 2);
      expect(peakAt(residual, centre)).toBeLessThan(residualMedian * 2);
    }
  }, 120_000);
});
