// Where text ink sits in an ROI over time, ported from the Studio's ink-scan.mjs: its box in frame pixels per
// sample, summarised as first and last visible time (cue timing against the heard words), the widest box (caption
// maximum width) and the median box height, which solves font size: render a candidate font at a known size,
// scan the same text there, and size = candidate size × median height here / median height there.
import { Fix, readFrames, round, type Roi } from "./media.js";

export interface InkSample {
  t: number;
  box: [number, number, number, number] | null;
  ink_px: number;
}

/** "light", "dark" or "R,G,B" as a pixel test within `tol`. */
function isInk(spec: string, tol: number): (r: number, g: number, b: number) => boolean {
  if (spec === "light") return (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b >= 255 - tol;
  if (spec === "dark") return (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b <= tol;
  const c = spec.split(",").map(Number);
  if (c.length !== 3 || c.some((v) => !Number.isFinite(v)))
    throw new Fix(`--ink must be light, dark or R,G,B, got "${spec}"`, "--ink 255,214,0");
  const [cr, cg, cb] = [c[0]!, c[1]!, c[2]!];
  return (r, g, b) => Math.hypot(r - cr, g - cg, b - cb) <= tol;
}

/** Samples at `fps` from `start` for `seconds`; `fps` 0 reads one frame at `start`. */
export function scan(
  path: string,
  start: number,
  seconds: number,
  [x, y, w, h]: Roi,
  {
    fps = 10,
    ink = "light",
    tol = 60,
    min = 12,
  }: { fps?: number; ink?: string; tol?: number; min?: number } = {},
): InkSample[] {
  const test = isInk(ink, tol);
  const { frames } = readFrames(path, { start, seconds, roi: [x, y, w, h], fps });
  // fallow-ignore-next-line complexity
  return (fps ? frames : frames.slice(0, 1)).map((f, i) => {
    let [x0, y0, x1, y1, n] = [w, h, -1, -1, 0];
    for (let py = 0; py < h; py++)
      for (let px = 0; px < w; px++) {
        const o = (py * w + px) * 3;
        if (!test(f[o]!, f[o + 1]!, f[o + 2]!)) continue;
        n++;
        if (px < x0) x0 = px;
        if (px > x1) x1 = px;
        if (py < y0) y0 = py;
        if (py > y1) y1 = py;
      }
    const t = round(start + (fps ? i / fps : 0));
    return n < min
      ? { t, box: null, ink_px: n }
      : { t, box: [x + x0, y + y0, x1 - x0 + 1, y1 - y0 + 1], ink_px: n };
  });
}

export function summary(rows: InkSample[]) {
  const on = rows.flatMap((r) => (r.box ? [r.box] : []));
  const times = rows.filter((r) => r.box).map((r) => r.t);
  const med = (v: number[]) => [...v].sort((a, b) => a - b)[v.length >> 1]!;
  if (!on.length) return { samples: rows.length, first_visible: null };
  return {
    samples: rows.length,
    visible_samples: on.length,
    first_visible: times[0]!,
    last_visible: times.at(-1)!,
    median_box_h: med(on.map((b) => b[3])),
    max_box_w: Math.max(...on.map((b) => b[2])),
    median_box: [0, 1, 2, 3].map((k) => med(on.map((b) => b[k]!))),
  };
}
