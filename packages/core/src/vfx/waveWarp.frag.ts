/**
 * `wave-warp` kernel — GLSL ES 3.00, capture `self`.
 *
 * **Scope (v1, recorded rather than implied):** After Effects builds a
 * 2048-entry displacement table per Wave Type on the CPU and reads it as
 * `disp = table[round(proj/65536 + phase) & 2047]`, where
 * `proj = (x + 1)·dirX + y·dirY`. The corpus needs **Wave Type 1 (Sine)** only
 * (Direction 0, Speed 1, Pinning 1, Phase 0, Height/Width animated), and Sine
 * ports analytically:
 *
 *     disp = height · sin(2π · (proj/width + phase/360 + speed·t))
 *
 * applied perpendicular to the direction of travel, sampling `u_src` at the
 * displaced coordinate with **clamp-to-transparent** edges. The other wave
 * types are not defs in v1 — the exporter marks them cosmetic — and a
 * 2048-wide strip probe is the upgrade path if the gate fails on Sine.
 *
 * **Pinning is not implemented (v1 = 1, "none").** The def's `pinning` option
 * list carries only that value, so `normalizeVfxParams` folds anything else
 * back to it, matching how `fractal-noise` handles Fractal Type.
 *
 * **Open question for the corpus gate:** `direction` is treated here as the
 * direction of *travel*, with the displacement perpendicular to it — the
 * reading the deep dive's `proj` formula supports. If After Effects' UI angle
 * instead names the *displacement* axis, every direction is 90° out and the
 * exporter's handler gains that offset. Corpus retro-wave uses Direction 0, so
 * the two readings differ only by which axis moves.
 */

/**
 * Angles arrive in degrees (AE's unit) and `phase` is degrees of one wave;
 * both meet `2π` here, so the constant is shared rather than spelled twice.
 */
export const WAVE_WARP_CONSTANTS = {
  tau: 6.283185307179586,
  degreesPerTurn: 360,
} as const;

const { tau, degreesPerTurn } = WAVE_WARP_CONSTANTS;

export const WAVE_WARP_FRAG = `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform vec2 u_size;
uniform float u_t;
uniform float u_fps;
uniform sampler2D u_src;
uniform float u_waveType;
uniform float u_height;
uniform float u_width;
uniform float u_direction;
uniform float u_speed;
uniform float u_pinning;
uniform float u_phase;

// Outside the layer's own box there is nothing to warp in from, so the wave
// carries transparency rather than a smeared edge pixel.
vec4 hfSampleSrc(vec2 uv) {
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return vec4(0.0);
  return texture(u_src, uv);
}

void main() {
  vec2 px = v_uv * u_size;
  float dir = radians(u_direction);
  vec2 travel = vec2(sin(dir), -cos(dir));
  vec2 swing = vec2(-travel.y, travel.x);
  float proj = (px.x + 1.0) * travel.x + px.y * travel.y;
  float turns = proj / max(u_width, 1.0) + u_phase / ${degreesPerTurn}.0 + u_speed * u_t;
  float disp = u_height * sin(${tau} * turns);
  fragColor = hfSampleSrc((px + swing * disp) / u_size);
}
`;
