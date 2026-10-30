/** Where each mover is across the shutter: its pose read at several times, then tapped. */

import type { MoverFrame } from "./composite";
import {
  type Affine,
  type createPoseReader,
  IDENTITY,
  autoTaps,
  tapsFromReads,
  translate,
} from "./pose";

export interface FrameRequest {
  movers: HTMLElement[];
  reader: ReturnType<typeof createPoseReader>;
  seek: (t: number) => void;
  t: number;
  /** Pose reads across the shutter; the taps between them are interpolated. */
  reads: number;
  shutterSeconds: number;
  /** A fixed tap count, or null to size the taps to each smear. */
  taps: number | null;
  /** Px each mover's box grows by on every side (its glow); none for a mover not listed. */
  pads?: ReadonlyMap<HTMLElement, number>;
  frameW: number;
  frameH: number;
}

export function readMoverFrames(req: FrameRequest): { els: HTMLElement[]; frames: MoverFrame[] } {
  const { reader: r, shutterSeconds: shutter, t, reads, seek } = req;
  const visible = req.movers.filter(
    (el) =>
      typeof el.checkVisibility !== "function" || el.checkVisibility({ visibilityProperty: true }),
  );
  if (visible.length === 0 || shutter <= 0) return { els: [], frames: [] };
  const start = t - shutter / 2;
  const poses = visible.map((): Affine[] => []);
  for (let j = 0; j < reads; j++) {
    seek(Math.max(0, start + (j / (reads - 1)) * shutter));
    r.reset();
    visible.forEach((el, i) => poses[i]?.push(r.pose(el)));
  }
  seek(t);
  r.reset();
  const frames = visible.map((el, i) => {
    const pad = req.pads?.get(el) ?? 0;
    const w = el.offsetWidth + 2 * pad;
    const h = el.offsetHeight + 2 * pad;
    const grow = (m: Affine): Affine => translate(m, -pad, -pad);
    const path = (poses[i] ?? [IDENTITY]).map(grow);
    return {
      w,
      h,
      now: grow(r.pose(el)),
      taps:
        req.taps === null
          ? autoTaps(path, w, h, req.frameW, req.frameH)
          : tapsFromReads(path, req.taps),
    };
  });
  r.reset();
  return { els: visible, frames };
}
