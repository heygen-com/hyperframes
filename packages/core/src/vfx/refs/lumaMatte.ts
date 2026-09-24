/**
 * CPU reference for the `luma-matte` kernel. Unlike `wave-warp`'s and
 * `displacement-map`'s, which return the coordinate they sample, this one
 * returns the colour: the kernel's whole decision is a per-pixel scale, and a
 * caller with both texels can check it exactly.
 *
 * Both texels are **premultiplied**, matching the textures the runtime uploads.
 */

import { normalizeVfxParams, type HfVfxParamValues } from "../../vfx";
import { DISPLACEMENT_MAP_CONSTANTS } from "../displacementMap.frag";
import { LUMA_MATTE_MODES } from "../lumaMatte.frag";

const { lumaR, lumaG, lumaB } = DISPLACEMENT_MAP_CONSTANTS;

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** The shader's `hfCoverage`. */
export function lumaMatteCoverageRef(matte: Rgba, mode: number): number {
  if (mode < LUMA_MATTE_MODES.alphaInverted) return matte.a;
  if (mode < LUMA_MATTE_MODES.luma) return 1 - matte.a;
  const luma = matte.r * lumaR + matte.g * lumaG + matte.b * lumaB;
  return mode < LUMA_MATTE_MODES.lumaInverted ? luma : 1 - luma;
}

/**
 * The colour the kernel paints. `t` is part of the call shape every kernel
 * reference shares; a matte is time-invariant — its animation arrives as
 * movement in the matte element itself.
 */
export function lumaMatteSampleRef(
  src: Rgba,
  matte: Rgba,
  t: number,
  params: HfVfxParamValues,
): Rgba {
  void t;
  const n = normalizeVfxParams("luma-matte", params);
  const coverage = Math.min(1, Math.max(0, lumaMatteCoverageRef(matte, Number(n["mode"]))));
  return { r: src.r * coverage, g: src.g * coverage, b: src.b * coverage, a: src.a * coverage };
}
