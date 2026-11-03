/** Where each mover is across the shutter: its pose read at several times, then tapped. */

import type { MoverFrame } from "./composite";
import {
  type Affine,
  type createPoseReader,
  IDENTITY,
  autoTaps,
  invert,
  tapsFromReads,
  translate,
} from "./pose";

/** Descendants read per mover per frame for its painted extent. */
const CONTENT_NODE_LIMIT = 256;

type Box = [number, number, number, number];

/** Maps client px back into the mover's own px: pose maps mover px to scene px, and the scene sits at its client rect, scaled to the frame. */
function clientToMover(pose: Affine, scene: HTMLElement, frameW: number): Affine | null {
  const sr = scene.getBoundingClientRect();
  const s = frameW > 0 && sr.width > 0 ? sr.width / frameW : 1;
  return invert({
    a: pose.a * s,
    b: pose.b * s,
    c: pose.c * s,
    d: pose.d * s,
    e: sr.left + pose.e * s,
    f: sr.top + pose.f * s,
  });
}

/** Grows `box` to hold client rect `r`, mapped into the mover's px by `back`. */
function growToRect(box: Box, back: Affine, r: DOMRect): void {
  for (const [x, y] of [
    [r.left, r.top],
    [r.right, r.top],
    [r.left, r.bottom],
    [r.right, r.bottom],
  ] as const) {
    const lx = back.a * x + back.c * y + back.e;
    const ly = back.b * x + back.d * y + back.f;
    box[0] = Math.min(box[0], lx);
    box[1] = Math.min(box[1], ly);
    box[2] = Math.max(box[2], lx);
    box[3] = Math.max(box[3], ly);
  }
}

/**
 * The mover's painted extent in its own px, `[x0, y0, x1, y1]`: its border box, grown to every
 * descendant that overflows it (text wider than the box, positioned children). The crop is cut to
 * this box, so content outside it would be dropped from the redraw.
 */
function contentBox(el: HTMLElement, pose: Affine, scene: HTMLElement, frameW: number): Box {
  const box: Box = [0, 0, el.offsetWidth, el.offsetHeight];
  const cs = getComputedStyle(el);
  if (cs.overflowX !== "visible" && cs.overflowY !== "visible") return box;
  const back = clientToMover(pose, scene, frameW);
  if (!back) return box;
  const walker = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_ELEMENT);
  for (let n = 0; n < CONTENT_NODE_LIMIT && walker.nextNode(); n++) {
    const r = (walker.currentNode as Element).getBoundingClientRect();
    if (r.width && r.height) growToRect(box, back, r);
  }
  return [Math.floor(box[0]), Math.floor(box[1]), Math.ceil(box[2]), Math.ceil(box[3])];
}

export interface FrameRequest {
  movers: HTMLElement[];
  reader: ReturnType<typeof createPoseReader>;
  seek: (t: number) => void;
  restore?: (t: number) => void;
  t: number;
  /** Pose reads across the shutter; the taps between them are interpolated. */
  reads: number;
  shutterSeconds: number;
  /** A fixed tap count, or null to size the taps to each smear. */
  taps: number | null;
  /** Px each mover's box grows by on every side (its glow); none for a mover not listed. */
  pads?: ReadonlyMap<HTMLElement, number>;
  /** The composition root the poses are relative to; with it, overflowing content is kept. */
  scene?: HTMLElement;
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
  (req.restore ?? seek)(t);
  r.reset();
  const frames = visible.map((el, i) => {
    const pad = req.pads?.get(el) ?? 0;
    const pose = r.pose(el);
    const [x0, y0, x1, y1] = req.scene
      ? contentBox(el, pose, req.scene, req.frameW)
      : [0, 0, el.offsetWidth, el.offsetHeight];
    const w = x1 - x0 + 2 * pad;
    const h = y1 - y0 + 2 * pad;
    const ox = x0 - pad;
    const oy = y0 - pad;
    const grow = (m: Affine): Affine => translate(m, ox, oy);
    const path = (poses[i] ?? [IDENTITY]).map(grow);
    return {
      w,
      h,
      origin: [ox, oy] as [number, number],
      now: grow(pose),
      taps:
        req.taps === null
          ? autoTaps(path, w, h, req.frameW, req.frameH)
          : tapsFromReads(path, req.taps),
    };
  });
  r.reset();
  return { els: visible, frames };
}
