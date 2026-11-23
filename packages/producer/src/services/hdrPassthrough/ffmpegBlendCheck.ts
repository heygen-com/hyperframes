/**
 * HDR passthrough blend self-test: does the ffmpeg the composite runs round
 * its 16-bit `maskedmerge` exactly as the layered path's
 * `blitRgba8OverRgb48le`?
 *
 * The passthrough's pixel contract rests on that rounding, and it is a
 * property of the ffmpeg build, not of the composition: 7.0 and 8.0 match on
 * every sample, 4.2 is 1 LSB off on about a sixth of the partial-alpha ones,
 * and nothing in between has been measured. Rather than trust a version
 * number, eligibility blends one small frame through the composite's own
 * filters (`buildBlendFilters`) on the binary `runFfmpeg` resolves, compares
 * it with the engine's blend of the same pixels, and declines
 * (`ffmpeg_unsupported`) unless every sample matches. The result is cached
 * per binary path for the life of the process.
 */

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  blitRgba8OverRgb48le,
  formatFfmpegError,
  getFfmpegBinary,
  getSrgbToSignalLut,
  runFfmpeg,
} from "@hyperframes/engine";
import { buildBlendFilters } from "./ffmpegComposite.js";

/** One column per 8-bit alpha, so every alpha the layered blend can see is tested. */
const CHECK_WIDTH = 256;
/** Rows of random colour pairs per alpha: 256 x 64 x 3 = 49152 samples. */
const CHECK_HEIGHT = 64;
/** Fixed seed: the check is the same on every run. */
const CHECK_SEED = 0x5eed_b1e4;

export type BlendCheckResult = { exact: true } | { exact: false; detail: string };

/** The check's three frames, in the composite's pixel formats. */
export interface BlendCheckSamples {
  width: number;
  height: number;
  /** The video frame, packed `rgb48le` (what the composite's video chain hands the blend). */
  video: Buffer;
  /** The overlay, packed `rgba64le`: RGB = `getSrgbToSignalLut(hlg)[srgb8]`, A = `a8 * 257`. */
  overlay: Buffer;
  /** `blitRgba8OverRgb48le` of the same pixels over `video`: the layered path's result. */
  expected: Buffer;
}

function mulberry32(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };
}

/**
 * Column `x` has alpha `x`; every pixel has a random 8-bit overlay colour
 * and a random 16-bit video colour, except the first two rows, which pin the
 * video to 0 and 65535 (the rounding extremes).
 */
export function buildBlendCheckSamples(
  width = CHECK_WIDTH,
  height = CHECK_HEIGHT,
): BlendCheckSamples {
  const random = mulberry32(CHECK_SEED);
  const lut = getSrgbToSignalLut("hlg");
  const pixels = width * height;
  const dom = new Uint8Array(pixels * 4);
  const video = Buffer.alloc(pixels * 6);
  const overlay = Buffer.alloc(pixels * 8);
  for (let i = 0; i < pixels; i++) {
    const row = Math.floor(i / width);
    const alpha = (i % width) % 256;
    for (let c = 0; c < 3; c++) {
      const srgb = random() & 0xff;
      dom[i * 4 + c] = srgb;
      overlay.writeUInt16LE(lut[srgb] ?? 0, i * 8 + c * 2);
      const base = row === 0 ? 0 : row === 1 ? 0xffff : random() & 0xffff;
      video.writeUInt16LE(base, i * 6 + c * 2);
    }
    dom[i * 4 + 3] = alpha;
    overlay.writeUInt16LE(alpha * 257, i * 8 + 6);
  }
  const expected = Buffer.from(video);
  blitRgba8OverRgb48le(dom, expected, width, height, "hlg");
  return { width, height, video, overlay, expected };
}

/** ffmpeg argv (without the binary) that blends the two raw frames into `outPath` as `rgb48le`. */
export function buildBlendCheckArgs(
  size: { width: number; height: number },
  paths: { video: string; overlay: string; out: string },
): string[] {
  const dims = `${size.width}x${size.height}`;
  const raw = (pixFmt: string, path: string) =>
    ["-f", "rawvideo", "-pix_fmt", pixFmt, "-s", dims, "-i", path] as const;
  return [
    "-hide_banner",
    "-v",
    "error",
    "-y",
    ...raw("rgb48le", paths.video),
    ...raw("rgba64le", paths.overlay),
    "-filter_complex",
    `${buildBlendFilters("scale=threads=4,format=gbrp16le")}[out]`,
    "-map",
    "[out]",
    "-frames:v",
    "1",
    "-f",
    "rawvideo",
    "-pix_fmt",
    "rgb48le",
    paths.out,
  ];
}

/** Compares ffmpeg's blend with the expected one, 16-bit sample by sample. */
export function compareBlendOutput(expected: Buffer, actual: Buffer): BlendCheckResult {
  if (actual.length !== expected.length) {
    return {
      exact: false,
      detail: `blend self-test wrote ${actual.length} bytes, expected ${expected.length}`,
    };
  }
  let mismatches = 0;
  let maxDiff = 0;
  for (let at = 0; at < expected.length; at += 2) {
    const diff = Math.abs(expected.readUInt16LE(at) - actual.readUInt16LE(at));
    if (diff === 0) continue;
    mismatches++;
    if (diff > maxDiff) maxDiff = diff;
  }
  if (mismatches === 0) return { exact: true };
  const samples = expected.length / 2;
  return {
    exact: false,
    detail: `maskedmerge misses the layered blend on ${mismatches} of ${samples} samples (up to ${maxDiff} LSB)`,
  };
}

/** Runs the check once on the current ffmpeg. Never throws: any failure is a non-exact result. */
export async function runBlendCheck(signal?: AbortSignal): Promise<BlendCheckResult> {
  const samples = buildBlendCheckSamples();
  const dir = await mkdtemp(join(tmpdir(), "hf-hdr-blend-check-"));
  try {
    const paths = {
      video: join(dir, "video.rgb48le"),
      overlay: join(dir, "overlay.rgba64le"),
      out: join(dir, "out.rgb48le"),
    };
    await writeFile(paths.video, samples.video);
    await writeFile(paths.overlay, samples.overlay);
    const result = await runFfmpeg(buildBlendCheckArgs(samples, paths), { signal });
    if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
    if (!result.success) {
      return {
        exact: false,
        detail: `blend self-test failed: ${formatFfmpegError(result.exitCode, result.stderr)}`,
      };
    }
    return compareBlendOutput(samples.expected, await readFile(paths.out));
  } catch (error) {
    if (signal?.aborted) throw error;
    const message = error instanceof Error ? error.message : String(error);
    return { exact: false, detail: `blend self-test failed: ${message}` };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const cache = new Map<string, Promise<BlendCheckResult>>();

/**
 * `runBlendCheck`, once per ffmpeg binary path per process. An aborted run
 * is not cached. The detail names the binary.
 */
export function checkFfmpegBlend(signal?: AbortSignal): Promise<BlendCheckResult> {
  const binary = getFfmpegBinary();
  let pending = cache.get(binary);
  if (!pending) {
    pending = runBlendCheck(signal).then((result) =>
      result.exact ? result : { exact: false, detail: `${binary}: ${result.detail}` },
    );
    cache.set(binary, pending);
    pending.catch(() => cache.delete(binary));
  }
  return pending;
}

/** Test hook: forget every cached result. */
export function resetFfmpegBlendCheckCache(): void {
  cache.clear();
}
