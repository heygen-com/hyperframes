/**
 * CPU reference for the `displacement-map` kernel. Like `wave-warp`'s it
 * returns the *source coordinate* the kernel samples rather than a colour.
 *
 * Coordinates are device pixels with y measured from the bottom — the shader's
 * `v_uv * u_size`, and the order `gl.readPixels` returns rows in.
 *
 * The kernel is a two-input operation even in v1, where both inputs happen to
 * be the same texture, so the map arrives as a sampler the caller supplies
 * rather than being implied. Its values are **premultiplied**, matching the
 * capture texture the runtime uploads.
 */

import { normalizeVfxParams, type HfVfxParamValues } from "../../vfx";
import { DISPLACEMENT_MAP_CONSTANTS } from "../displacementMap.frag";

const { lumaR, lumaG, lumaB } = DISPLACEMENT_MAP_CONSTANTS;

export interface MapTexel {
  r: number;
  g: number;
  b: number;
  a: number;
}

export type MapSampler = (x: number, y: number) => MapTexel;

/** The shader's `hfMapChannel`. */
function mapChannel(texel: MapTexel, selector: number): number {
  const scale = texel.a > 0 ? 1 / texel.a : 0;
  const r = texel.r * scale;
  const g = texel.g * scale;
  const b = texel.b * scale;
  if (selector < 1.5) return r;
  if (selector < 2.5) return g;
  if (selector < 3.5) return b;
  if (selector < 4.5) return texel.a;
  if (selector < 8.5) return r * lumaR + g * lumaG + b * lumaB;
  if (selector < 9.5) return 1;
  return 0.5;
}

/**
 * Where the kernel reads from to paint `(x, y)`, in the same pixel space.
 *
 * `t` is part of the call shape every kernel reference shares; Displacement Map
 * is time-invariant — its animation arrives as tweened `maxH`/`maxV`.
 */
export function displacementMapSampleRef(
  p: { x: number; y: number },
  t: number,
  params: HfVfxParamValues,
  map: MapSampler,
): { x: number; y: number } {
  void t;
  const n = normalizeVfxParams("displacement-map", params) as Record<string, number>;
  const texel = map(p.x, p.y);
  const h = mapChannel(texel, n["useH"]!);
  const v = mapChannel(texel, n["useV"]!);
  return {
    x: p.x + (h - 0.5) * 2 * n["maxH"]!,
    y: p.y + (v - 0.5) * 2 * n["maxV"]!,
  };
}
