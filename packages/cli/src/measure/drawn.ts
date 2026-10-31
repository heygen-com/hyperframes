// A drawn element (text, a badge, a card) over a regenerated person, scored by itself, since what is behind it differs
// on purpose: each frame aligns the element's ink on both sides within a few pixels and asks how much of either side's
// ink the other matches in colour. Wrong weight, size, fill or a late onset leave ink unmatched; a new background none.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { round, runFfmpeg, type Clip, type Roi } from "./media.js";

export const DRAWN_MIN_MEAN = 0.8;
const DRAWN_MIN_P05 = 0.65;
// A pixel is ink when its colour is this far (RGB distance) from its neighbourhood's median.
const INK_CONTRAST = 60;
// Two pixels match within this RGB distance, one pixel apart at most, after aligning the sides this many pixels.
const MATCH_COLOUR = 45;
const ALIGN = 3;
// Fewer ink pixels than this on both sides: nothing drawn in that frame on either side.
const MIN_INK = 30;
const MAX_FPS = 10;

export interface DrawnFrame {
  /** Share of both sides' ink the other side matches (F1 of matched ink), or null when neither side has ink. */
  score: number | null;
  /** Where yours sits against the original, x and y in pixels (within ±3; further lowers the score). */
  offset: [number, number];
  inkOriginal: number;
  inkYours: number;
}

export interface DrawnVerdict {
  box: Roi;
  window: [number, number];
  frames: number;
  pass: boolean | null;
  /** Mean and 5th percentile of the frames' scores. */
  score?: number;
  p05?: number;
  /** Median of the frames' offsets. */
  offset?: [number, number];
  /** Yours' ink over the original's, median of frames where both have ink: under 1 is lighter or smaller. */
  ink?: number;
}

/** Each pixel's colour distance from the median colour of the blocks around it. */
// fallow-ignore-next-line complexity
export function contrast(px: Uint8Array, w: number, h: number): Float32Array {
  const bs = Math.max(4, Math.floor(Math.max(8, Math.floor(h / 2)) / 2));
  const [gw, gh] = [Math.ceil(w / bs), Math.ceil(h / bs)];
  const med = new Float32Array(gw * gh * 3);
  const hist = new Uint32Array(256);
  for (let by = 0; by < gh; by++)
    for (let bx = 0; bx < gw; bx++) {
      const [x0, x1] = [Math.max(0, (bx - 1) * bs), Math.min(w, (bx + 2) * bs)];
      const [y0, y1] = [Math.max(0, (by - 1) * bs), Math.min(h, (by + 2) * bs)];
      const half = ((x1 - x0) * (y1 - y0)) / 2;
      for (let c = 0; c < 3; c++) {
        hist.fill(0);
        for (let y = y0; y < y1; y++)
          for (let x = x0; x < x1; x++) hist[px[(y * w + x) * 3 + c]!]!++;
        let [v, seen] = [0, 0];
        while (v < 255 && seen + hist[v]! < half) seen += hist[v++]!;
        med[(by * gw + bx) * 3 + c] = v;
      }
    }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const [o, m] = [(y * w + x) * 3, (Math.floor(y / bs) * gw + Math.floor(x / bs)) * 3];
      out[y * w + x] = Math.hypot(
        px[o]! - med[m]!,
        px[o + 1]! - med[m + 1]!,
        px[o + 2]! - med[m + 2]!,
      );
    }
  return out;
}

const inkOf = (px: Uint8Array, w: number, h: number) => {
  const c = contrast(px, w, h);
  return Uint8Array.from(c, (v) => (v > INK_CONTRAST ? 1 : 0));
};

/** One frame of an element: the original's and yours' RGB crops of the same box. */
// fallow-ignore-next-line complexity
export function scoreDrawnFrame(a: Uint8Array, b: Uint8Array, w: number, h: number): DrawnFrame {
  const [ia, ib] = [inkOf(a, w, h), inkOf(b, w, h)];
  const [na, nb] = [ia.reduce((s, v) => s + v, 0), ib.reduce((s, v) => s + v, 0)];
  if (na + nb < MIN_INK) return { score: null, offset: [0, 0], inkOriginal: na, inkYours: nb };
  let mostOverlappingShift = { iou: -1, dx: 0, dy: 0 };
  for (let dy = -ALIGN; dy <= ALIGN; dy++)
    for (let dx = -ALIGN; dx <= ALIGN; dx++) {
      let [both, either] = [0, 0];
      for (let y = 0; y < h; y++) {
        const sy = y - dy;
        for (let x = 0; x < w; x++) {
          const sx = x - dx;
          const vb = sy >= 0 && sy < h && sx >= 0 && sx < w ? ib[sy * w + sx]! : 0;
          const va = ia[y * w + x]!;
          both += va & vb;
          either += va | vb;
        }
      }
      const iou = either ? both / either : 0;
      if (iou > mostOverlappingShift.iou) mostOverlappingShift = { iou, dx, dy };
    }
  // Ink on either side counts as matched when the other side has a pixel of its colour within one pixel.
  const at = (x: number, y: number) =>
    (Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))) * 3;
  const near = (p: Uint8Array, o: number, q: Uint8Array, x: number, y: number) => {
    for (let ry = -1; ry <= 1; ry++)
      for (let rx = -1; rx <= 1; rx++) {
        const k = at(x + rx, y + ry);
        if (Math.hypot(p[o]! - q[k]!, p[o + 1]! - q[k + 1]!, p[o + 2]! - q[k + 2]!) < MATCH_COLOUR)
          return true;
      }
    return false;
  };
  let [hitA, hitB, inkA, inkB] = [0, 0, 0, 0];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const [sx, sy] = [x - mostOverlappingShift.dx, y - mostOverlappingShift.dy];
      const inB = sy >= 0 && sy < h && sx >= 0 && sx < w && ib[sy * w + sx] === 1;
      if (ia[i]) {
        inkA++;
        if (near(a, i * 3, b, sx, sy)) hitA++;
      }
      if (inB) {
        inkB++;
        if (near(b, at(sx, sy), a, x, y)) hitB++;
      }
    }
  const [recall, precision] = [inkA ? hitA / inkA : 0, inkB ? hitB / inkB : 0];
  return {
    score: recall + precision ? (2 * recall * precision) / (recall + precision) : 0,
    offset: [0 - mostOverlappingShift.dx, 0 - mostOverlappingShift.dy],
    inkOriginal: na,
    inkYours: nb,
  };
}

const median = (v: number[]) => [...v].sort((x, y) => x - y)[v.length >> 1] ?? 0;

export function drawnVerdict(
  box: Roi,
  window: [number, number],
  frames: DrawnFrame[],
): DrawnVerdict {
  const head = { box, window, frames: frames.length };
  const scored = frames.flatMap((f) => (f.score === null ? [] : [f]));
  if (!scored.length) return { ...head, pass: null };
  const sorted = scored.map((f) => f.score!).sort((x, y) => x - y);
  const mean = sorted.reduce((s, v) => s + v, 0) / sorted.length;
  const p05 = sorted[Math.min(sorted.length - 1, Math.floor(0.05 * sorted.length))]!;
  const both = scored.filter((f) => f.inkOriginal >= MIN_INK && f.inkYours >= MIN_INK);
  return {
    ...head,
    pass: mean >= DRAWN_MIN_MEAN && p05 >= DRAWN_MIN_P05,
    score: round(mean, 3),
    p05: round(p05, 3),
    offset: [median(scored.map((f) => f.offset[0])), median(scored.map((f) => f.offset[1]))],
    ...(both.length ? { ink: round(median(both.map((f) => f.inkYours / f.inkOriginal)), 2) } : {}),
  };
}

export interface DrawnJob {
  box: Roi;
  /** Indexes into the compared frames (the clips' frames after their own filters), in order. */
  frames: number[];
}

/**
 * Each job's crops from a clip scaled to `width`x`height` (the original's size), one decode for all of them:
 * `frames[j][n]` is job j's n-th frame, RGB at the box's size.
 */
export function readDrawn(
  clip: Clip,
  jobs: DrawnJob[],
  width: number,
  height: number,
): Uint8Array[][] {
  if (!jobs.length) return [];
  const work = mkdtempSync(join(tmpdir(), "hf-diff-drawn-"));
  try {
    const tags = jobs.map((_, j) => `[d${j}]`).join("");
    const graph = [
      `[0:v]${[...clip.filters, "setsar=1", `scale=${width}:${height}:flags=bicubic`].join(",")},split=${jobs.length}${tags}`,
      ...jobs.map(({ box: [x, y, w, h], frames }, j) => {
        const pick = frames.map((k) => `eq(n\\,${k})`).join("+");
        return `[d${j}]select=${pick},crop=${w}:${h}:${x}:${y},format=rgb24[e${j}]`;
      }),
    ].join(";");
    const outs = jobs.flatMap((_, j) => [
      ...["-map", `[e${j}]`, "-fps_mode", "passthrough", "-f", "rawvideo", `e${j}.rgb`],
    ]);
    runFfmpeg([...clip.input, "-an", "-filter_complex", graph, ...outs], undefined, work);
    return jobs.map(({ box: [, , w, h] }, j) => {
      const raw = readFileSync(join(work, `e${j}.rgb`));
      const size = w * h * 3;
      const frames: Uint8Array[] = [];
      for (let i = 0; i + size <= raw.length; i += size) frames.push(raw.subarray(i, i + size));
      return frames;
    });
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** The compared frames (indexes into `ks`) inside [a, b) seconds, thinned to MAX_FPS. */
export function drawnFrames(
  ks: number[],
  fps: number,
  a: number,
  b: number,
  available: number,
): number[] {
  const stride = Math.max(1, Math.round(fps / MAX_FPS));
  const inside = ks.flatMap((k, i) =>
    i < available && k / fps >= a - 1e-6 && k / fps < b - 1e-6 ? [i] : [],
  );
  // Every stride-th frame of a run of consecutive frames; moments already that far apart (--at) all count.
  let last = -Infinity;
  return inside.filter((i) => {
    if (ks[i]! - last < stride) return false;
    last = ks[i]!;
    return true;
  });
}
