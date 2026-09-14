/**
 * Pixel-level PNG comparison for the golden baseline gate.
 *
 * Pure diff math on raw RGBA buffers (unit-testable without Chrome or
 * fixtures) plus thin sharp-backed encode/decode helpers. No new
 * dependencies: sharp is already a CLI dependency for contact sheets.
 */

import sharp from "sharp";

/** Decoded RGBA image (4 channels, row-major). */
export interface RawImage {
  width: number;
  height: number;
  data: Uint8Array;
}

export interface PixelDiffOptions {
  /**
   * Per-channel intensity tolerance as a fraction of 255 (default 0.1).
   * A pixel only counts as different when at least one channel deviates
   * by more than `threshold * 255`.
   */
  threshold?: number;
  /**
   * Treat 1px edge shifts as anti-aliasing noise and exclude them from the
   * failure count (default true). A differing pixel is classified as
   * anti-aliasing when each side finds a matching pixel for the other
   * side's color within its own 8-neighborhood — the signature of font /
   * shape rasterization jitter, not a layout or color regression.
   */
  ignoreAntialiasing?: boolean;
}

export interface PixelDiffResult {
  width: number;
  height: number;
  totalPixels: number;
  /** Differing pixels that count against the gate (anti-aliasing excluded). */
  diffPixels: number;
  /** Differing pixels classified as anti-aliasing noise and ignored. */
  aaPixels: number;
  /** diffPixels / totalPixels. */
  diffRatio: number;
  /** Max per-channel delta (0-255) among counted differing pixels. */
  maxDelta: number;
  /** Baseline and current image dimensions do not match. */
  dimensionMismatch: boolean;
  /** RGBA visualization: dimmed baseline, red = diff, amber = ignored AA. */
  diff: Uint8Array;
}

export const DEFAULT_DIFF_THRESHOLD = 0.1;

const DIFF_COLOR = { r: 255, g: 0, b: 64 };
const AA_COLOR = { r: 255, g: 196, b: 0 };

function channelDelta(a: RawImage, b: RawImage, aOffset: number, bOffset: number): number {
  let max = 0;
  for (let channel = 0; channel < 4; channel++) {
    const delta = Math.abs(a.data[aOffset + channel]! - b.data[bOffset + channel]!);
    if (delta > max) max = delta;
  }
  return max;
}

/** True when some pixel in `img`'s 8-neighborhood of (x, y) matches the RGBA at `targetOffset` in `target` within `tolerance`. */
function neighborhoodMatches(
  img: RawImage,
  x: number,
  y: number,
  target: RawImage,
  targetOffset: number,
  tolerance: number,
): boolean {
  const left = Math.max(0, x - 1);
  const right = Math.min(img.width - 1, x + 1);
  const top = Math.max(0, y - 1);
  const bottom = Math.min(img.height - 1, y + 1);
  for (let ny = top; ny <= bottom; ny++) {
    for (let nx = left; nx <= right; nx++) {
      if (nx === x && ny === y) continue;
      const offset = (ny * img.width + nx) * 4;
      if (channelDelta(img, target, offset, targetOffset) <= tolerance) return true;
    }
  }
  return false;
}

function paint(diff: Uint8Array, offset: number, color: { r: number; g: number; b: number }): void {
  diff[offset] = color.r;
  diff[offset + 1] = color.g;
  diff[offset + 2] = color.b;
  diff[offset + 3] = 255;
}

/** Pale grayscale rendering of the baseline pixel, so diffs pop against context. */
function paintBackground(diff: Uint8Array, baseline: RawImage, offset: number): void {
  const luma = Math.round(
    0.299 * baseline.data[offset]! +
      0.587 * baseline.data[offset + 1]! +
      0.114 * baseline.data[offset + 2]!,
  );
  const dimmed = Math.round(luma * 0.25 + 190);
  diff[offset] = dimmed;
  diff[offset + 1] = dimmed;
  diff[offset + 2] = dimmed;
  diff[offset + 3] = 255;
}

function dimensionMismatchResult(baseline: RawImage): PixelDiffResult {
  const totalPixels = baseline.width * baseline.height;
  const diff = new Uint8Array(totalPixels * 4);
  for (let offset = 0; offset < diff.length; offset += 4) {
    paint(diff, offset, DIFF_COLOR);
  }
  return {
    width: baseline.width,
    height: baseline.height,
    totalPixels,
    diffPixels: totalPixels,
    aaPixels: 0,
    diffRatio: 1,
    maxDelta: 255,
    dimensionMismatch: true,
    diff,
  };
}

interface PixelComparison {
  diff: Uint8Array;
  diffPixels: number;
  aaPixels: number;
  maxDelta: number;
}

function comparePixels(
  baseline: RawImage,
  current: RawImage,
  tolerance: number,
  ignoreAntialiasing: boolean,
): PixelComparison {
  const diff = new Uint8Array(baseline.width * baseline.height * 4);
  const result: PixelComparison = { diff, diffPixels: 0, aaPixels: 0, maxDelta: 0 };

  for (let y = 0; y < baseline.height; y++) {
    for (let x = 0; x < baseline.width; x++) {
      const offset = (y * baseline.width + x) * 4;
      const delta = channelDelta(baseline, current, offset, offset);
      if (delta <= tolerance) {
        paintBackground(diff, baseline, offset);
        continue;
      }
      const isAntialiasing =
        ignoreAntialiasing &&
        neighborhoodMatches(baseline, x, y, current, offset, tolerance) &&
        neighborhoodMatches(current, x, y, baseline, offset, tolerance);
      if (isAntialiasing) {
        result.aaPixels++;
        paint(diff, offset, AA_COLOR);
        continue;
      }
      result.diffPixels++;
      result.maxDelta = Math.max(result.maxDelta, delta);
      paint(diff, offset, DIFF_COLOR);
    }
  }
  return result;
}

/**
 * Compare two RGBA images of equal dimensions. Baseline dimensions win for
 * the visualization; mismatched dimensions are reported as a total failure
 * (a resized canvas is always a regression, not a pixel drift).
 */
export function diffRawImages(
  baseline: RawImage,
  current: RawImage,
  options: PixelDiffOptions = {},
): PixelDiffResult {
  if (baseline.width !== current.width || baseline.height !== current.height) {
    return dimensionMismatchResult(baseline);
  }

  const threshold = options.threshold ?? DEFAULT_DIFF_THRESHOLD;
  const tolerance = Math.round(Math.max(0, Math.min(1, threshold)) * 255);
  const totalPixels = baseline.width * baseline.height;
  const compared = comparePixels(
    baseline,
    current,
    tolerance,
    options.ignoreAntialiasing !== false,
  );

  return {
    width: baseline.width,
    height: baseline.height,
    totalPixels,
    diffPixels: compared.diffPixels,
    aaPixels: compared.aaPixels,
    diffRatio: totalPixels === 0 ? 0 : compared.diffPixels / totalPixels,
    maxDelta: compared.maxDelta,
    dimensionMismatch: false,
    diff: compared.diff,
  };
}

/** Decode a PNG file path or buffer into flat RGBA. */
export async function decodeRawImage(input: string | Uint8Array): Promise<RawImage> {
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({
    resolveWithObject: true,
  });
  return { width: info.width, height: info.height, data: new Uint8Array(data) };
}

/** Encode flat RGBA back into a PNG file. */
export async function writeRawImagePng(image: RawImage, outputPath: string): Promise<void> {
  await sharp(Buffer.from(image.data.buffer, image.data.byteOffset, image.data.byteLength), {
    raw: { width: image.width, height: image.height, channels: 4 },
  })
    .png()
    .toFile(outputPath);
}

/** Convenience wrapper: decode two PNGs (path or buffer) and diff them. */
export async function diffPngs(
  baseline: string | Uint8Array,
  current: string | Uint8Array,
  options: PixelDiffOptions = {},
): Promise<PixelDiffResult> {
  const [baselineRaw, currentRaw] = await Promise.all([
    decodeRawImage(baseline),
    decodeRawImage(current),
  ]);
  return diffRawImages(baselineRaw, currentRaw, options);
}
