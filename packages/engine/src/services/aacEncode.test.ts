import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { getFfmpegBinary, getFfprobeBinary } from "../utils/ffmpegBinaries.js";
import { aacSegmentCount, encodeAac, splitAdtsFrames } from "./aacEncode.js";

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

  it("encodes a long mix in parallel segments that decode like one encoder's output", async () => {
    const source = join(dir, "mix.wav");
    ffmpeg([
      ...["-f", "lavfi", "-i", "anoisesrc=d=150.5:c=pink:r=48000:a=0.2"],
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
