/**
 * CPU reference for the `wave-warp` kernel. It returns the *source coordinate*
 * the kernel samples rather than a colour: the displacement is the whole of
 * what the kernel decides, and a caller with the source image can look the
 * colour up itself.
 *
 * Coordinates are device pixels with y measured from the bottom — the shader's
 * `v_uv * u_size`, and the order `gl.readPixels` returns rows in.
 */

import { normalizeVfxParams, type HfVfxParamValues } from "../../vfx";
import { WAVE_WARP_CONSTANTS } from "../waveWarp.frag";

const { tau, degreesPerTurn } = WAVE_WARP_CONSTANTS;

/** Where the kernel reads from to paint `(x, y)`, in the same pixel space. */
export function waveWarpSampleRef(
  p: { x: number; y: number },
  t: number,
  params: HfVfxParamValues,
): { x: number; y: number } {
  const n = normalizeVfxParams("wave-warp", params) as Record<string, number>;
  const dir = (n["direction"]! * Math.PI) / 180;
  const travelX = Math.sin(dir);
  const travelY = -Math.cos(dir);
  const proj = (p.x + 1) * travelX + p.y * travelY;
  const turns = proj / Math.max(n["width"]!, 1) + n["phase"]! / degreesPerTurn + n["speed"]! * t;
  const disp = n["height"]! * Math.sin(tau * turns);
  // The displacement swings perpendicular to the direction of travel.
  return { x: p.x - travelY * disp, y: p.y + travelX * disp };
}
