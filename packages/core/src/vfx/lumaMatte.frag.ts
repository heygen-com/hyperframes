/**
 * `luma-matte` kernel — GLSL ES 3.00, capture `self` plus a `ref` second
 * source.
 *
 * **What it ports.** Not a single After Effects effect: this is the runtime
 * form of every matte the exporter cannot express as CSS — a track matte whose
 * source layer is unsupported (`matte-source-unsupported:*`), a stencil or
 * silhouette (`stencil-*`), and Set Matte. All of them are the same
 * per-pixel operation, `out = src · coverage(matte)`, differing only in which
 * element is the source and which is the matte. The exporter decides that by
 * choosing which element the host wraps and which the `matte` ref names; a
 * stencil is this kernel with the host's own content as the matte.
 *
 * **Coverage.** `src` arrives premultiplied, so scaling all four channels by a
 * single coverage value is the whole operation — no unpremultiply/repremultiply
 * round trip, and a coverage of 0 yields a genuinely empty pixel rather than a
 * black one.
 *
 * - Alpha (1) / Alpha Inverted (2): the matte's alpha.
 * - Luma (3) / Luma Inverted (4): the matte's luminance **composited over
 *   black**, which is what the premultiplied texel already holds — a matte that
 *   is 50 % grey at 50 % opacity reads as 0.25, matching After Effects, where a
 *   luma matte's transparent regions are black rather than ignored.
 *
 * Rec.601 weights, shared with `displacement-map`'s Luminance channel selector
 * so the two agree on what "luminance" means.
 *
 * **Out of scope in v1, recorded rather than implied:** the matte is sampled at
 * the host's own `v_uv`, so the runtime captures it into the host's box (see
 * `captureSource`). After Effects places a matte layer in composition space
 * with its own transform; a matte whose box differs from the layer's is
 * therefore stretched here, not positioned. Every corpus matte is a
 * full-frame sibling of its layer, where the two agree.
 */

import { DISPLACEMENT_MAP_CONSTANTS } from "./displacementMap.frag";

const { lumaR, lumaG, lumaB } = DISPLACEMENT_MAP_CONSTANTS;

/** The `mode` enum, named once so the def, the shader and the reference agree. */
export const LUMA_MATTE_MODES = {
  alpha: 1,
  alphaInverted: 2,
  luma: 3,
  lumaInverted: 4,
} as const;

export const LUMA_MATTE_FRAG = `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform vec2 u_size;
uniform float u_t;
uniform float u_fps;
uniform sampler2D u_src;
uniform sampler2D u_src2;
uniform float u_mode;

// The matte texel is premultiplied, so its rgb is already "over black" — the
// composite After Effects reads a luma matte through.
float hfCoverage(vec4 matte, float mode) {
  if (mode < 1.5) return matte.a;
  if (mode < 2.5) return 1.0 - matte.a;
  float luma = dot(matte.rgb, vec3(${lumaR}, ${lumaG}, ${lumaB}));
  if (mode < 3.5) return luma;
  return 1.0 - luma;
}

void main() {
  vec4 src = texture(u_src, v_uv);
  vec4 matte = texture(u_src2, v_uv);
  fragColor = src * clamp(hfCoverage(matte, u_mode), 0.0, 1.0);
}
`;
