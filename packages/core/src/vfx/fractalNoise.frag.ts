/**
 * `fractal-noise` kernel — GLSL ES 3.00, capture `none`.
 *
 * **Scope (v1, recorded rather than implied):** After Effects' Fractal Noise
 * builds a 64×64 CPU lattice per Random Seed / Evolution and runs one of 17
 * fractal-type kernels over it. The corpus needs exactly one point of that
 * space (Basic, Noise Type 3, Complexity 6, Sub Influence 70 %, Sub Scaling
 * 56 %, Contrast 562, Scale 411, Evolution 0, Seed 0, **Opacity 5 %**), and at
 * 5 % opacity an approximate fBm is very likely to pass the gate. So this is
 * the classic textbook construction — value noise on an integer lattice, a
 * fixed 32-bit hash, `complexity` octaves with lacunarity `100/subScaling` and
 * gain `subInfluence/100`, then AE's linear contrast/brightness remap.
 * **Exactness against AE is not claimed in v1**; a Tier-1 decode of
 * `FracBASICKernel` plus the lattice is the upgrade path.
 *
 * Two v1 approximations worth naming:
 * - **Evolution** translates the noise field rather than rotating it. AE
 *   evolves through a third axis; 2-D value noise has none, and the corpus
 *   point is Evolution 0.
 * - **Noise Type** selects the interpolation curve (Block / Linear / Soft
 *   Linear / Spline) rather than a different lattice.
 *
 * The kernel is time-invariant: animation reaches it through `evolution`, not
 * through `u_t`. `u_t`/`u_fps`/`u_fractalType` are declared for the uniform
 * contract and go unread, which is why a GL driver may optimise them away.
 */

/**
 * The single source of truth for the hash. Both this GLSL string and the CPU
 * reference (`refs/fractalNoise.ts`) are built from these numbers, so a change
 * to the picture cannot land in one without the other.
 */
export const HASH_CONSTANTS = {
  /** Odd 32-bit multipliers, one per lattice axis plus one for the seed. */
  mulX: 374761393,
  mulY: 668265263,
  mulMix: 1274126177,
  /** 2^32/φ — breaks the all-zero fixed point at lattice corner (0, 0). */
  offset: 2654435769,
  shift1: 13,
  shift2: 16,
  /** 2^32: maps the mixed 32-bit word into [0, 1). */
  divisor: 4294967296,
} as const;

const { mulX, mulY, mulMix, offset, shift1, shift2, divisor } = HASH_CONSTANTS;

/** The most octaves any chain can ask for — the def clamps `complexity` to 20. */
const MAX_OCTAVES = 20;

export const FRACTAL_NOISE_FRAG = `#version 300 es
precision highp float;
precision highp int;

in vec2 v_uv;
out vec4 fragColor;

uniform vec2 u_size;
uniform float u_t;
uniform float u_fps;
uniform float u_fractalType;
uniform float u_noiseType;
uniform float u_invert;
uniform float u_contrast;
uniform float u_brightness;
uniform float u_scale;
uniform float u_complexity;
uniform float u_subInfluence;
uniform float u_subScaling;
uniform float u_evolution;
uniform float u_randomSeed;
uniform float u_opacity;

float hfHashUnit(int ix, int iy, int seed) {
  uint h = ((uint(ix) * ${mulX}u) ^ (uint(iy) * ${mulY}u) ^ (uint(seed) * ${mulMix}u)) + ${offset}u;
  h = h ^ (h >> ${shift1}u);
  h = h * ${mulMix}u;
  h = h ^ (h >> ${shift2}u);
  return float(h) / ${divisor}.0;
}

float hfFade(float f, float noiseType) {
  if (noiseType < 1.5) return 0.0;
  if (noiseType < 2.5) return f;
  if (noiseType < 3.5) return f * f * (3.0 - 2.0 * f);
  return f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
}

float hfValueNoise(vec2 p, int seed) {
  vec2 cell = floor(p);
  vec2 f = p - cell;
  int ix = int(cell.x);
  int iy = int(cell.y);
  float sx = hfFade(f.x, u_noiseType);
  float sy = hfFade(f.y, u_noiseType);
  float bottom = mix(hfHashUnit(ix, iy, seed), hfHashUnit(ix + 1, iy, seed), sx);
  float top = mix(hfHashUnit(ix, iy + 1, seed), hfHashUnit(ix + 1, iy + 1, seed), sx);
  return mix(bottom, top, sy);
}

float hfFbm(vec2 p) {
  float lacunarity = 100.0 / max(u_subScaling, 1.0);
  float gain = u_subInfluence / 100.0;
  int seed = int(u_randomSeed);
  float amp = 1.0;
  float freq = 1.0;
  float sum = 0.0;
  float norm = 0.0;
  for (int i = 0; i < ${MAX_OCTAVES}; i++) {
    if (float(i) >= u_complexity) break;
    sum += amp * hfValueNoise(p * freq, seed + i);
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return norm > 0.0 ? sum / norm : 0.0;
}

void main() {
  vec2 px = v_uv * u_size;
  vec2 p = px / max(u_scale, 1.0) + vec2(u_evolution, u_evolution * 0.5);
  float v = hfFbm(p);
  v = (v - 0.5) * (u_contrast / 100.0) + 0.5 + u_brightness / 100.0;
  if (u_invert > 0.5) v = 1.0 - v;
  v = clamp(v, 0.0, 1.0);
  float a = clamp(u_opacity / 100.0, 0.0, 1.0);
  fragColor = vec4(v * a, v * a, v * a, a);
}
`;
