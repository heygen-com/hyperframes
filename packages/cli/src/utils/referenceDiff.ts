/**
 * Reference-grounded frame measurements.
 *
 * Every other gate in the CLI is self-referential: it inspects the composition
 * against its own rules and can pass a scene that renders nothing like the
 * thing it is supposed to reproduce. These helpers compare a rendered replica
 * frame against an external reference frame and return numbers, so "close
 * enough" stops being a judgement call.
 */

/**
 * Luma distance from the frame's median before a pixel counts as ink.
 *
 * ponytail: a single global threshold on the median. Good for type/graphic
 * frames (the case this exists for); a full-bleed photo makes every pixel ink
 * and the bounds degenerate to the whole canvas. Swap in per-region stats if
 * photographic frames ever need real bounds.
 */
const INK_DELTA = 32;

export interface InkBounds {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  width: number;
  height: number;
  cx: number;
  cy: number;
  empty: boolean;
}

export interface BoundsDeviation {
  /** Replica minus reference, in reference pixels. */
  dw: number;
  dh: number;
  dcx: number;
  dcy: number;
  /** Replica ink width as a fraction of reference ink width (1 = identical). */
  scale: number;
}

const EMPTY_BOUNDS: InkBounds = {
  x0: 0,
  y0: 0,
  x1: 0,
  y1: 0,
  width: 0,
  height: 0,
  cx: 0,
  cy: 0,
  empty: true,
};

function medianLuma(gray: Uint8Array): number {
  const histogram = new Uint32Array(256);
  for (const value of gray) histogram[value]! += 1;
  const half = gray.length / 2;
  let seen = 0;
  for (let level = 0; level < 256; level++) {
    seen += histogram[level]!;
    if (seen >= half) return level;
  }
  return 0;
}

/** Bounding box of everything that is not background, from an 8-bit grayscale plane. */
export function inkBounds(gray: Uint8Array, width: number, height: number): InkBounds {
  if (width <= 0 || height <= 0 || gray.length < width * height) return EMPTY_BOUNDS;
  const median = medianLuma(gray);
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;

  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      if (Math.abs(gray[row + x]! - median) <= INK_DELTA) continue;
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
  }

  if (x1 < 0) return EMPTY_BOUNDS;
  return {
    x0,
    y0,
    x1,
    y1,
    width: x1 - x0 + 1,
    height: y1 - y0 + 1,
    cx: (x0 + x1 + 1) / 2,
    cy: (y0 + y1 + 1) / 2,
    empty: false,
  };
}

export function boundsDeviation(reference: InkBounds, replica: InkBounds): BoundsDeviation {
  return {
    dw: replica.width - reference.width,
    dh: replica.height - reference.height,
    dcx: replica.cx - reference.cx,
    dcy: replica.cy - reference.cy,
    scale: reference.width > 0 ? replica.width / reference.width : 0,
  };
}

/** Mean per-pixel luma difference, normalized to 0 (identical) .. 1 (inverted). */
export function meanAbsDiff(reference: Uint8Array, replica: Uint8Array): number {
  const length = Math.min(reference.length, replica.length);
  if (length === 0) return 1;
  let total = 0;
  for (let i = 0; i < length; i++) total += Math.abs(reference[i]! - replica[i]!);
  return total / (length * 255);
}

/**
 * Mean *signed* luma difference (replica minus reference), normalized to -1..1.
 *
 * Separates the two things `meanAbsDiff` sums together. A comparison whose
 * signed value is close to its absolute value is uniformly lighter or darker,
 * which is a level shift from encoding or colour conversion, not a structural
 * error. Signed near zero with a large absolute value means the deviation is
 * real and localized.
 */
export function meanSignedDiff(reference: Uint8Array, replica: Uint8Array): number {
  const length = Math.min(reference.length, replica.length);
  if (length === 0) return 0;
  let total = 0;
  for (let i = 0; i < length; i++) total += replica[i]! - reference[i]!;
  return total / (length * 255);
}

/**
 * Interleaved RGB where the reference drives red and the replica drives
 * green+blue: agreement reads neutral grey, reference-only ink glows red,
 * replica-only ink glows cyan.
 */
export function redCyanOverlayRaw(
  reference: Uint8Array,
  replica: Uint8Array,
  width: number,
  height: number,
): Buffer {
  const pixels = width * height;
  const out = Buffer.allocUnsafe(pixels * 3);
  for (let i = 0; i < pixels; i++) {
    const ref = reference[i] ?? 0;
    const rep = replica[i] ?? 0;
    out[i * 3] = ref;
    out[i * 3 + 1] = rep;
    out[i * 3 + 2] = rep;
  }
  return out;
}

/** Pull the full-frame SSIM out of ffmpeg's `ssim` filter log line. */
export function parseSsimAll(stderr: string): number | null {
  let value: number | null = null;
  for (const match of stderr.matchAll(/\bAll:\s*([0-9]*\.?[0-9]+)/g)) {
    const parsed = Number(match[1]);
    if (Number.isFinite(parsed)) value = parsed;
  }
  return value;
}
