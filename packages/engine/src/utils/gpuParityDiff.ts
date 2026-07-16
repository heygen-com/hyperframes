/**
 * GPU Parity Diff — diagnostic helpers for detecting shape-dependent
 * hardware-GPU capture bugs by comparing frames captured via the two
 * capture paths (hardware-GPU vs software-GPU / screenshot bypass).
 *
 * Field pattern this exists to catch:
 *
 *   • ts=1784049136 · hardware-GPU capture emitted intermittent black
 *     rectangles in one scene; `--no-browser-gpu --low-memory-mode
 *     --workers 1` (software-GPU screenshot mode) resolved it.
 *   • ts=1784032286 · animated `clip-path` on a large image → intermittent
 *     black rectangles from Chrome capture; deterministic precomposited
 *     swipe states removed the artifact.
 *   • Baseline · JetBrains Mono glyph-drop on parallel/BeginFrame text
 *     capture.
 *
 * Common shape: hardware-GPU writes solid-black regions where content
 * should exist; software-GPU / screenshot fallback renders the same
 * region correctly. A raw per-pixel diff is a coarse signal for this —
 * on its own it fires on every animation frame's compositor jitter, so
 * this module also isolates the *asymmetric* black-in-A-only pattern
 * that is the diagnostic fingerprint of the bug.
 *
 * This module is the reduced-scope first pass: a pure helper + unit
 * tests. Wiring a `hyperframes verify-gpu-parity` CLI surface, capture
 * orchestration, and integration coverage is intentionally deferred to
 * a follow-up so the diagnostic primitive can land and be exercised
 * against real captured frames in isolation.
 */

import { decodePng } from "./alphaBlit.js";

// ── Types ───────────────────────────────────────────────────────────────────

/** A decoded RGBA frame. Matches the shape returned by `decodePng`. */
export interface RgbaFrame {
  width: number;
  height: number;
  data: Uint8Array;
}

export interface GpuParityDiffOptions {
  /**
   * Per-channel absolute difference at which a pixel is considered "differing".
   * A pixel counts as differing if any of R/G/B channels differ by more than
   * this value. Default 8 (tolerates minor compositor jitter / dithering).
   */
  pixelChannelTolerance?: number;
  /**
   * A pixel qualifies as "solid black" when R + G + B is ≤ this value.
   * Default 12 (covers hardware capture bugs that write pure #000 as well
   * as slightly off-black values from Chrome's compositor).
   */
  blackSumThreshold?: number;
  /**
   * A pixel qualifies as "has content" (non-black) when R + G + B is ≥ this
   * value. Default 32 — deliberately higher than `blackSumThreshold` so the
   * two categories cannot overlap on borderline near-black pixels.
   */
  contentSumThreshold?: number;
  /**
   * A frame is flagged as failing parity when the black-only-in-A fraction
   * of pixels exceeds this value. Default 0.001 (~0.1% of the frame).
   * Lowering trades sensitivity for false-positive risk on legitimate
   * animation frames that momentarily contain a small black shape only on
   * one capture path.
   */
  blackOnlyFractionThreshold?: number;
}

export interface BlackOnlyInARegion {
  /** Count of pixels that are black in A but have content in B. */
  pixels: number;
  /** `pixels / (width * height)`. */
  fraction: number;
  /**
   * Axis-aligned bounding box of all black-only-in-A pixels. `null` when
   * `pixels === 0`. This is intentionally coarse — a single bbox is
   * cheaper than connected-component labeling and is sufficient to
   * localize the "one large black rectangle" pattern the field bugs
   * produce. Callers wanting per-region detail can extend this later.
   */
  boundingBox: { x: number; y: number; width: number; height: number } | null;
}

export interface GpuParityDiffResult {
  /** Frame dimensions (both inputs must match). */
  width: number;
  height: number;
  /** Total pixels compared. */
  totalPixels: number;
  /** Pixels differing beyond `pixelChannelTolerance`. */
  diffPixels: number;
  /** `diffPixels / totalPixels`. */
  diffFraction: number;
  /**
   * Pixels that are solid-black in A (the hardware-GPU frame by
   * convention) *and* have content in B (the software-GPU frame). This
   * is the diagnostic-grade signal for shape-dependent hardware-GPU
   * capture bugs.
   */
  blackOnlyInA: BlackOnlyInARegion;
  /**
   * Symmetric counterpart — black in B but content in A. Useful for
   * ruling out the inverse (extremely rare in the wild, but if it
   * shows up it means the software path is the buggy one).
   */
  blackOnlyInB: BlackOnlyInARegion;
}

export interface VerifyGpuParityResult {
  ok: boolean;
  /** Human-readable failure summary; empty when `ok === true`. */
  reason: string;
  diff: GpuParityDiffResult;
}

// ── Defaults ────────────────────────────────────────────────────────────────

const DEFAULT_PIXEL_CHANNEL_TOLERANCE = 8;
const DEFAULT_BLACK_SUM_THRESHOLD = 12;
const DEFAULT_CONTENT_SUM_THRESHOLD = 32;
const DEFAULT_BLACK_ONLY_FRACTION_THRESHOLD = 0.001;

// ── Core diff ───────────────────────────────────────────────────────────────

/**
 * Compare two RGBA frames captured via different GPU paths.
 *
 * The two inputs must have identical dimensions; on mismatch this throws
 * (with the mismatched sizes surfaced in the message) so callers cannot
 * silently compare misaligned frames.
 *
 * Alpha channel is *not* considered for the black-only detection — Chrome's
 * capture output is opaque along the code paths this diagnostic targets,
 * and considering alpha would false-positive on legitimately transparent
 * pixels. `pixelChannelTolerance` also compares only R/G/B for the same
 * reason.
 */
export function diffGpuParityFrames(
  a: RgbaFrame,
  b: RgbaFrame,
  options: GpuParityDiffOptions = {},
): GpuParityDiffResult {
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(
      `diffGpuParityFrames: frame size mismatch — A is ${a.width}x${a.height}, ` +
        `B is ${b.width}x${b.height}`,
    );
  }
  const expectedLen = a.width * a.height * 4;
  if (a.data.length !== expectedLen) {
    throw new Error(
      `diffGpuParityFrames: frame A data length ${a.data.length} does not match ` +
        `expected ${expectedLen} (${a.width}x${a.height} * 4)`,
    );
  }
  if (b.data.length !== expectedLen) {
    throw new Error(
      `diffGpuParityFrames: frame B data length ${b.data.length} does not match ` +
        `expected ${expectedLen} (${b.width}x${b.height} * 4)`,
    );
  }

  const tol = options.pixelChannelTolerance ?? DEFAULT_PIXEL_CHANNEL_TOLERANCE;
  const blackSum = options.blackSumThreshold ?? DEFAULT_BLACK_SUM_THRESHOLD;
  const contentSum = options.contentSumThreshold ?? DEFAULT_CONTENT_SUM_THRESHOLD;

  if (contentSum <= blackSum) {
    throw new Error(
      `diffGpuParityFrames: contentSumThreshold (${contentSum}) must be strictly greater ` +
        `than blackSumThreshold (${blackSum}) — overlapping thresholds would double-classify ` +
        `borderline pixels`,
    );
  }

  const total = a.width * a.height;
  const aData = a.data;
  const bData = b.data;

  let diffPixels = 0;
  let blackOnlyAPixels = 0;
  let blackOnlyBPixels = 0;

  let aMinX = a.width;
  let aMinY = a.height;
  let aMaxX = -1;
  let aMaxY = -1;
  let bMinX = a.width;
  let bMinY = a.height;
  let bMaxX = -1;
  let bMaxY = -1;

  for (let y = 0; y < a.height; y++) {
    for (let x = 0; x < a.width; x++) {
      const i = (y * a.width + x) * 4;
      const ar = aData[i] ?? 0;
      const ag = aData[i + 1] ?? 0;
      const ab = aData[i + 2] ?? 0;
      const br = bData[i] ?? 0;
      const bg = bData[i + 1] ?? 0;
      const bb = bData[i + 2] ?? 0;

      if (Math.abs(ar - br) > tol || Math.abs(ag - bg) > tol || Math.abs(ab - bb) > tol) {
        diffPixels++;
      }

      const aSum = ar + ag + ab;
      const bSum = br + bg + bb;

      if (aSum <= blackSum && bSum >= contentSum) {
        blackOnlyAPixels++;
        if (x < aMinX) aMinX = x;
        if (y < aMinY) aMinY = y;
        if (x > aMaxX) aMaxX = x;
        if (y > aMaxY) aMaxY = y;
      } else if (bSum <= blackSum && aSum >= contentSum) {
        blackOnlyBPixels++;
        if (x < bMinX) bMinX = x;
        if (y < bMinY) bMinY = y;
        if (x > bMaxX) bMaxX = x;
        if (y > bMaxY) bMaxY = y;
      }
    }
  }

  return {
    width: a.width,
    height: a.height,
    totalPixels: total,
    diffPixels,
    diffFraction: diffPixels / total,
    blackOnlyInA: {
      pixels: blackOnlyAPixels,
      fraction: blackOnlyAPixels / total,
      boundingBox:
        blackOnlyAPixels === 0
          ? null
          : { x: aMinX, y: aMinY, width: aMaxX - aMinX + 1, height: aMaxY - aMinY + 1 },
    },
    blackOnlyInB: {
      pixels: blackOnlyBPixels,
      fraction: blackOnlyBPixels / total,
      boundingBox:
        blackOnlyBPixels === 0
          ? null
          : { x: bMinX, y: bMinY, width: bMaxX - bMinX + 1, height: bMaxY - bMinY + 1 },
    },
  };
}

/**
 * PNG-buffer convenience wrapper around `diffGpuParityFrames`. Decodes
 * both inputs via `decodePng` and delegates. Errors from the decoder are
 * re-thrown with `cause` preserved so the failing side (A or B) is
 * obvious in the stack.
 */
export function diffGpuParityPngs(
  pngA: Buffer,
  pngB: Buffer,
  options: GpuParityDiffOptions = {},
): GpuParityDiffResult {
  let a: RgbaFrame;
  let b: RgbaFrame;
  try {
    a = decodePng(pngA);
  } catch (err) {
    throw new Error(`diffGpuParityPngs: failed to decode frame A`, { cause: err });
  }
  try {
    b = decodePng(pngB);
  } catch (err) {
    throw new Error(`diffGpuParityPngs: failed to decode frame B`, { cause: err });
  }
  return diffGpuParityFrames(a, b, options);
}

/**
 * Verdict wrapper — returns `{ ok, reason }` suitable for a follow-up
 * CLI or gate to emit. `ok === false` when either black-only fraction
 * exceeds `blackOnlyFractionThreshold`. Raw diff numbers are always
 * included on both branches so callers can log or gate on their own
 * metrics without a second pass.
 */
export function verifyGpuParity(
  a: RgbaFrame,
  b: RgbaFrame,
  options: GpuParityDiffOptions = {},
): VerifyGpuParityResult {
  const diff = diffGpuParityFrames(a, b, options);
  const threshold = options.blackOnlyFractionThreshold ?? DEFAULT_BLACK_ONLY_FRACTION_THRESHOLD;

  if (diff.blackOnlyInA.fraction > threshold) {
    const bb = diff.blackOnlyInA.boundingBox;
    const region = bb ? ` (bbox ${bb.x},${bb.y} ${bb.width}x${bb.height})` : "";
    return {
      ok: false,
      reason:
        `hardware-GPU frame has ${diff.blackOnlyInA.pixels} pixel(s) ` +
        `(${(diff.blackOnlyInA.fraction * 100).toFixed(3)}%) that are solid-black ` +
        `while software-GPU frame has content there${region} — likely shape-dependent ` +
        `hardware-GPU capture bug`,
      diff,
    };
  }
  if (diff.blackOnlyInB.fraction > threshold) {
    const bb = diff.blackOnlyInB.boundingBox;
    const region = bb ? ` (bbox ${bb.x},${bb.y} ${bb.width}x${bb.height})` : "";
    return {
      ok: false,
      reason:
        `software-GPU frame has ${diff.blackOnlyInB.pixels} pixel(s) ` +
        `(${(diff.blackOnlyInB.fraction * 100).toFixed(3)}%) that are solid-black ` +
        `while hardware-GPU frame has content there${region} — unexpected inverse ` +
        `pattern, worth investigating`,
      diff,
    };
  }
  return { ok: true, reason: "", diff };
}
