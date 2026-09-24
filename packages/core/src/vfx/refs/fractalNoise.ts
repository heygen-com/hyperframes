/**
 * CPU reference for the `fractal-noise` kernel — a pure function of the same
 * inputs the GLSL gets, built from the same `HASH_CONSTANTS`. The determinism
 * contract's cross-backend bar (PSNR ≥ 32 dB, K = 4 sample frames) is measured
 * against this, so it must stay a line-for-line mirror of the shader rather
 * than an independent idea of what the effect should look like.
 *
 * Coordinates are **device pixels with y measured from the bottom** — the
 * shader's `v_uv * u_size`, and the order `gl.readPixels` returns rows in. The
 * shader samples fragment centres, so a caller comparing against pixel
 * `(i, j)` should pass `(i + 0.5, j + 0.5)`.
 */

import { normalizeVfxParams, type HfVfxParamValues } from "../../vfx";
import { HASH_CONSTANTS } from "../fractalNoise.frag";

const { mulX, mulY, mulMix, offset, shift1, shift2, divisor } = HASH_CONSTANTS;

/**
 * The shader's `hfHashUnit`. `Math.imul` + `>>> 0` reproduce GLSL's 32-bit
 * `uint` wrap-around exactly; without them JS would carry the products into
 * doubles and drift from the GPU immediately.
 */
export function fractalNoiseHashUnit(ix: number, iy: number, seed: number): number {
  let h = ((Math.imul(ix, mulX) ^ Math.imul(iy, mulY) ^ Math.imul(seed, mulMix)) >>> 0) + offset;
  h = h >>> 0;
  h = (h ^ (h >>> shift1)) >>> 0;
  h = Math.imul(h, mulMix) >>> 0;
  h = (h ^ (h >>> shift2)) >>> 0;
  return h / divisor;
}

/** Noise Type picks the interpolation curve: Block, Linear, Soft Linear, Spline. */
function fade(f: number, noiseType: number): number {
  if (noiseType < 1.5) return 0;
  if (noiseType < 2.5) return f;
  if (noiseType < 3.5) return f * f * (3 - 2 * f);
  return f * f * f * (f * (f * 6 - 15) + 10);
}

function mix(a: number, b: number, w: number): number {
  return a + (b - a) * w;
}

function valueNoise(px: number, py: number, seed: number, noiseType: number): number {
  const cx = Math.floor(px);
  const cy = Math.floor(py);
  const sx = fade(px - cx, noiseType);
  const sy = fade(py - cy, noiseType);
  const bottom = mix(
    fractalNoiseHashUnit(cx, cy, seed),
    fractalNoiseHashUnit(cx + 1, cy, seed),
    sx,
  );
  const top = mix(
    fractalNoiseHashUnit(cx, cy + 1, seed),
    fractalNoiseHashUnit(cx + 1, cy + 1, seed),
    sx,
  );
  return mix(bottom, top, sy);
}

interface FbmSettings {
  complexity: number;
  subInfluence: number;
  subScaling: number;
  randomSeed: number;
  noiseType: number;
}

function fbm(px: number, py: number, s: FbmSettings): number {
  const lacunarity = 100 / Math.max(s.subScaling, 1);
  const gain = s.subInfluence / 100;
  let amp = 1;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < s.complexity; i++) {
    sum += amp * valueNoise(px * freq, py * freq, s.randomSeed + i, s.noiseType);
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return norm > 0 ? sum / norm : 0;
}

/**
 * The grey level the kernel writes at `(x, y)`, in [0, 1]. The shader then
 * premultiplies it by `opacity/100` and writes that as alpha; this returns the
 * unpremultiplied value so a caller can check either.
 *
 * `t` is part of the call shape every kernel reference shares. Fractal Noise
 * is time-invariant — its animation arrives as a tweened `evolution` — so it
 * is deliberately unread here.
 */
export function fractalNoiseRef(
  p: { x: number; y: number },
  t: number,
  params: HfVfxParamValues,
): number {
  void t;
  const n = normalizeVfxParams("fractal-noise", params) as Record<string, number | boolean>;
  const scale = Math.max(n["scale"] as number, 1);
  const evolution = n["evolution"] as number;
  const px = p.x / scale + evolution;
  const py = p.y / scale + evolution * 0.5;
  let v = fbm(px, py, {
    complexity: n["complexity"] as number,
    subInfluence: n["subInfluence"] as number,
    subScaling: n["subScaling"] as number,
    randomSeed: Math.trunc(n["randomSeed"] as number),
    noiseType: n["noiseType"] as number,
  });
  v = (v - 0.5) * ((n["contrast"] as number) / 100) + 0.5 + (n["brightness"] as number) / 100;
  if (n["invert"] === true) v = 1 - v;
  return Math.min(1, Math.max(0, v));
}
