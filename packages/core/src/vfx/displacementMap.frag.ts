/**
 * `displacement-map` kernel — GLSL ES 3.00, capture `self`.
 *
 * **The map layer.** Every corpus instance points its Displacement Map Layer
 * at **the layer itself** (retro-wave `Main/Text` → idx 5 = Text; `Logo Anim/
 * Text Site` and `Logo Anim/Logo` likewise), so `u_src` is both the source and
 * the map and no second capture is needed — that is what the `map` ref param
 * being EMPTY means, and it stays the default. An external map layer is the
 * same kernel reading `u_src2`: the exporter names that element in `map` and
 * wraps it in its own `.hf-vfx-src` capture, and `u_hasSrc2` switches the
 * sampler. The two inputs are read at the same `v_uv`, so an external map is
 * scaled into the host's box (see `captureSource`), not placed in composition
 * space.
 *
 * Per axis: `d = (channel(map) − 0.5) · 2 · max`, then sample `u_src` at
 * `uv + d/u_size` with **clamp-to-transparent** edges (Edge = Off, the only
 * mode v1 implements). Behavior is Center Map only. `expand` is carried for
 * the exporter but is a no-op: the host's box is the output.
 *
 * **Channel selector.** 1 Red, 2 Green, 3 Blue, 4 Alpha, 5 Luminance,
 * 9 Full, 10 Half, 11 Off are implemented as themselves. 6 Hue, 7 Lightness
 * and 8 Saturation are **read as Luminance** rather than being dropped back to
 * the param's default — for Use For Horizontal that default is Red, which
 * would be a much larger error than luminance. The exporter still marks them
 * for verification.
 *
 * The capture texture is premultiplied, so a colour channel is unpremultiplied
 * before it is read; alpha is read straight.
 *
 * **Open question for the corpus gate, same family as `wave-warp`'s
 * `direction`:** the vertical displacement is applied in the shader's y-up
 * pixel space, so a Green above 0.5 moves the sample *up* the frame. After
 * Effects works in y-down. Corpus retro-wave animates both maxima from 0, so
 * the sign shows up as a mirrored wobble rather than a missing one; if the gate
 * disagrees, negating `d.y` here (and in the reference) is the whole fix.
 */

/** Rec.601 luma — what After Effects calls Luminance in these selectors. */
export const DISPLACEMENT_MAP_CONSTANTS = {
  lumaR: 0.299,
  lumaG: 0.587,
  lumaB: 0.114,
} as const;

const { lumaR, lumaG, lumaB } = DISPLACEMENT_MAP_CONSTANTS;

export const DISPLACEMENT_MAP_FRAG = `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform vec2 u_size;
uniform float u_t;
uniform float u_fps;
uniform sampler2D u_src;
uniform sampler2D u_src2;
// 1 when the map ref named another element, 0 when the map is the layer
// itself. Set by the runtime for every pass, from whether a ref resolved.
uniform float u_hasSrc2;
uniform float u_useH;
uniform float u_maxH;
uniform float u_useV;
uniform float u_maxV;
uniform float u_behavior;
uniform float u_edge;
uniform float u_expand;

vec4 hfSampleSrc(vec2 uv) {
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return vec4(0.0);
  return texture(u_src, uv);
}

// The selector's value, in [0, 1]. Half and Off both land on 0.5, which is the
// "no displacement" midpoint the caller subtracts.
float hfMapChannel(vec4 premultiplied, float selector) {
  vec3 rgb = premultiplied.a > 0.0 ? premultiplied.rgb / premultiplied.a : vec3(0.0);
  if (selector < 1.5) return rgb.r;
  if (selector < 2.5) return rgb.g;
  if (selector < 3.5) return rgb.b;
  if (selector < 4.5) return premultiplied.a;
  if (selector < 8.5) return dot(rgb, vec3(${lumaR}, ${lumaG}, ${lumaB}));
  if (selector < 9.5) return 1.0;
  return 0.5;
}

void main() {
  vec4 mapTexel = u_hasSrc2 > 0.5 ? texture(u_src2, v_uv) : texture(u_src, v_uv);
  float h = hfMapChannel(mapTexel, u_useH);
  float v = hfMapChannel(mapTexel, u_useV);
  vec2 d = vec2((h - 0.5) * 2.0 * u_maxH, (v - 0.5) * 2.0 * u_maxV);
  fragColor = hfSampleSrc(v_uv + d / u_size);
}
`;
