/**
 * The filter tier's arithmetic: what an SVG filter on a mover needs to smear it along its sampled
 * path. Pure, so it can be checked without a browser.
 *
 * A filter runs in the element's own space, before its transform. The box centre's displacement
 * across the shutter becomes one offset per tap, taken back through the element's linear part.
 * Turn and scale cannot be offsets, so they soften the copies instead; so does the step between
 * copies, along the motion only.
 */

import type { MoverFrame } from "./composite";
import type { Affine } from "./pose";

export interface FilterPlan {
  /** One per tap: where that copy of the element sits, in its own px. */
  offsets: Array<[number, number]>;
  /** Gaussian softening, in its own px, along x and y. */
  sigma: [number, number];
  /** The filter region in the element's own px: every copy, the softening and the ink around it. */
  region: { x: number; y: number; w: number; h: number };
}

/** Softening as a share of the step between copies; enough to close the steps, no more. */
const STEP_SOFTEN = 0.35;
const TURN_SOFTEN = 0.29;
/** Below this, nothing is visible: the mover is left as it is. */
const MIN_TRAVEL = 0.5;
const MIN_SIGMA = 0.35;

const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));
const centre = (m: Affine, w: number, h: number): [number, number] => [
  m.a * (w / 2) + m.c * (h / 2) + m.e,
  m.b * (w / 2) + m.d * (h / 2) + m.f,
];

export function planFilter(frame: MoverFrame, pad: number, frameW: number): FilterPlan | null {
  const { w, h, now, taps } = frame;
  const det = now.a * now.d - now.b * now.c;
  const scale = Math.sqrt(Math.abs(det));
  if (taps.length < 2 || !(scale > 1e-4)) return null;

  const here = centre(now, w, h);
  const points = taps.map((m) => centre(m, w, h));
  const offsets = points.map(([x, y]): [number, number] => {
    const dx = x - here[0];
    const dy = y - here[1];
    return [(now.d * dx - now.c * dy) / det, (-now.b * dx + now.a * dy) / det];
  });

  let path = 0;
  for (let i = 1; i < points.length; i++) {
    path += Math.hypot(
      (points[i]?.[0] ?? 0) - (points[i - 1]?.[0] ?? 0),
      (points[i]?.[1] ?? 0) - (points[i - 1]?.[1] ?? 0),
    );
  }
  const step = path / (points.length - 1);

  const turn = Math.max(
    ...taps.map((m) => Math.abs(wrap(Math.atan2(m.b, m.a) - Math.atan2(now.b, now.a)))),
  );
  const grow = Math.max(
    ...taps.map((m) => Math.abs(Math.log(Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)) / scale))),
  );
  const size = Math.sqrt(w * h) * scale;
  const turnSigma = Math.min(
    24 * (frameW / 1920),
    TURN_SOFTEN * Math.min(frameW / 4, size / 2) * (turn + grow),
  );

  const first = offsets[0] ?? [0, 0];
  const last = offsets[offsets.length - 1] ?? [0, 0];
  const along = Math.hypot(last[0] - first[0], last[1] - first[1]) || 1;
  const stepSigma = (STEP_SOFTEN * step) / scale;
  const sigma: [number, number] = [
    Math.hypot(turnSigma / scale, (stepSigma * Math.abs(last[0] - first[0])) / along),
    Math.hypot(turnSigma / scale, (stepSigma * Math.abs(last[1] - first[1])) / along),
  ];

  if (path < MIN_TRAVEL && Math.max(...sigma) * scale < MIN_SIGMA) return null;

  const xs = offsets.map((o) => o[0]);
  const ys = offsets.map((o) => o[1]);
  const margin = pad + 3 * Math.max(...sigma) + 2;
  const x = Math.min(0, ...xs) - margin;
  const y = Math.min(0, ...ys) - margin;
  return {
    offsets,
    sigma,
    region: {
      x,
      y,
      w: w + Math.max(0, ...xs) + margin - x,
      h: h + Math.max(0, ...ys) + margin - y,
    },
  };
}
