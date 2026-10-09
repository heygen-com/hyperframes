/**
 * CPU reference for the `noise` kernel — the same integer hash the shader
 * runs, in 32-bit wrapping arithmetic. JavaScript's `>>> 0` and `Math.imul`
 * reproduce C's `unsigned int` overflow exactly, which is the property the
 * whole port rests on.
 *
 * Returns the noise OFFSET applied to a pixel, not the colour: the offset is
 * the entirety of what the kernel computes, and the add-and-clip around it is
 * two lines a caller can apply itself.
 */

import { normalizeVfxParams, type HfVfxParamValues } from "../../vfx";
import { NOISE_CONSTANTS } from "../noise.frag";

const { lcgMulA, lcgMulB, lcgAdd, highMask, lowMask, byteScale } = NOISE_CONSTANTS;

/** Bob Jenkins' 1997 integer mix, the metallib's sequence verbatim. */
function jenkinsMix(a0: number, b0: number, c0: number): number {
  let a = a0 >>> 0;
  let b = b0 >>> 0;
  let c = c0 >>> 0;
  a = (a - b - c) ^ (c >>> 13);
  b = (b - c - a) ^ (a << 8);
  c = (c - a - b) ^ (b >>> 13);
  a = (a - b - c) ^ (c >>> 12);
  b = (b - c - a) ^ (a << 16);
  c = (c - a - b) ^ (b >>> 5);
  a = (a - b - c) ^ (c >>> 3);
  b = (b - c - a) ^ (a << 10);
  c = (c - a - b) ^ (b >>> 15);
  return c >>> 0;
}

/** The hash's 15-bit output byte for one channel index `a`. */
export function noiseByteRef(a: number, y: number, seed: number): number {
  const h = jenkinsMix(a, y, seed);
  const t2 = (Math.imul(h, lcgMulA) + lcgAdd) >>> 0;
  const t4 = (Math.imul(t2, lcgMulB) + lcgAdd) >>> 0;
  return (((t4 >>> 16) & lowMask) ^ ((t2 >>> 9) & highMask)) >>> 0;
}

/**
 * The 32-bit seed the kernel hashes with. Interim, pending the Task 4.3 probe:
 * the frame index goes in the low half and the high half is zero. The packing
 * itself is the metallib's (`inRandomSeed_High` << 16 | `inRandomSeed_Low`), so
 * the probe's answer replaces the arguments, not the shape.
 */
export function noiseSeedRef(t: number, fps: number): number {
  const frame = Math.floor(t * fps + 0.5);
  return Math.max(frame, 0) & 0xffff;
}

/**
 * The per-channel noise offset the kernel adds at pixel `(x, y)` — `y` counted
 * from the TOP of the layer, as After Effects indexes its buffer.
 */
export function noiseOffsetRef(
  p: { x: number; y: number },
  t: number,
  fps: number,
  params: HfVfxParamValues,
): { r: number; g: number; b: number } {
  const n = normalizeVfxParams("noise", params);
  const amount = Number(n["amount"]) * 0.01;
  const seed = noiseSeedRef(t, fps);
  const x = Math.max(Math.floor(p.x), 0);
  const y = Math.max(Math.floor(p.y), 0);
  const bytes = n["useColorNoise"]
    ? [
        noiseByteRef(x * 3, y, seed),
        noiseByteRef(x * 3 + 1, y, seed),
        noiseByteRef(x * 3 + 2, y, seed),
      ]
    : Array<number>(3).fill(noiseByteRef(x, y, seed));
  const [r, g, b] = bytes.map((byte) => amount * (byte / byteScale - 0.5));
  return { r: r!, g: g!, b: b! };
}
