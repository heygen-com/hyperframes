// One layer of a project scored by what it adds: the project is captured with and without the layer, the layer's
// footprint is where the two differ, and over it benefit = 1 − MAE(original, with) / MAE(original, without). The
// layer's place and size are fitted against the original and reported as an instruction ("move down 10 px").
import { constants, cpSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { round } from "./media.js";

/** A pixel is the layer's when any channel differs this much between the captures with and without it. */
const FOOTPRINT_LEVELS = 25;
const MIN_FOOTPRINT = 100;
/** Under this mean error leaving the layer out already matches the original where it draws: no benefit to score. */
const REDUNDANT_MAE = 8;
const SHIFT = 40;
const SHIFT_STEP = 2;
const SCALES = [0.8, 0.85, 0.9, 0.95, 1.05, 1.1, 1.15, 1.2];
const SCALE_SHIFT = 6;
/** A resize is reported only when it fits this much better than the best move alone; a 5% step otherwise fits noise. */
const SCALE_GAIN = 0.9;
/** The fit reads at most this many footprint pixels, evenly strided: a full-frame layer would cost minutes a moment. */
const FIT_SAMPLE = 20000;

export interface LayerFrame {
  t: number;
  footprint_px: number;
  /** The footprint's box in the original's pixels: x, y, w, h. */
  bbox?: [number, number, number, number];
  mae_with?: number;
  mae_without?: number;
  /** 1 matches the original, 0 is no better than leaving the layer out, below 0 is worse. */
  benefit?: number | null;
  /** The original's copy of the layer sits this far (x, y) and this many times ours from the footprint's centre. */
  fit?: { offset: [number, number]; scale: number; mae: number };
  instruction?: string;
  note?: string;
}

export interface LayerVerdict {
  selector: string;
  frames: LayerFrame[];
  benefit_median: number | null;
  /** Moments where the layer is further from the original than leaving it out. */
  worse: number[];
  /** Moments where leaving the layer out already matches the original: not scored. */
  redundant: number[];
}

/** A clone of the project (copy-on-write where the disk allows) whose index.html hides `selector`. */
export function hiddenCopy(project: string, selector: string): string {
  const dir = mkdtempSync(join(tmpdir(), "hf-diff-hidden-"));
  for (const name of readdirSync(project))
    if (name !== "renders" && name !== "node_modules")
      cpSync(join(project, name), join(dir, name), {
        recursive: true,
        mode: constants.COPYFILE_FICLONE,
      });
  const index = join(dir, "index.html");
  const html = readFileSync(index, "utf8");
  const style = `<style>${selector}{visibility:hidden!important}</style>`;
  writeFileSync(
    index,
    html.includes("</head>") ? html.replace("</head>", `${style}</head>`) : style + html,
  );
  return dir;
}

function mae(a: Uint8Array, b: Uint8Array, idx: Int32Array, bIdx: Int32Array = idx): number {
  let sum = 0;
  for (let n = 0; n < idx.length; n++)
    for (let c = 0; c < 3; c++) sum += Math.abs(a[idx[n]! * 3 + c]! - b[bIdx[n]! * 3 + c]!);
  return sum / (idx.length * 3);
}

/** The original's pixels the footprint lands on when shifted by (dx, dy) and scaled about (cx, cy). */
function moved(
  xs: Int32Array,
  ys: Int32Array,
  w: number,
  h: number,
  [cx, cy]: [number, number],
  scale: number,
  dx: number,
  dy: number,
): Int32Array {
  const out = new Int32Array(xs.length);
  for (let n = 0; n < xs.length; n++) {
    const x = Math.min(w - 1, Math.max(0, Math.round(cx + scale * (xs[n]! - cx) + dx)));
    const y = Math.min(h - 1, Math.max(0, Math.round(cy + scale * (ys[n]! - cy) + dy)));
    out[n] = y * w + x;
  }
  return out;
}

export function instruction([dx, dy]: [number, number], scale: number): string {
  const parts = [
    ...(dy ? [`move ${dy > 0 ? "down" : "up"} ${Math.abs(dy)} px`] : []),
    ...(dx ? [`move ${dx > 0 ? "right" : "left"} ${Math.abs(dx)} px`] : []),
    ...(scale === 1
      ? []
      : [`make it ${Math.round(Math.abs(scale - 1) * 100)}% ${scale > 1 ? "larger" : "smaller"}`]),
  ];
  return parts.join(", ") || "in place";
}

/** The pixels (row-major indexes) where the captures with and without the layer differ. */
function footprintOf(withLayer: Uint8Array, without: Uint8Array, pixels: number): Int32Array {
  const at: number[] = [];
  for (let i = 0; i < pixels; i++)
    for (let c = 0; c < 3; c++)
      if (Math.abs(withLayer[i * 3 + c]! - without[i * 3 + c]!) > FOOTPRINT_LEVELS) {
        at.push(i);
        break;
      }
  return Int32Array.from(at);
}

type Fit = { offset: [number, number]; scale: number; mae: number };

/** Where the original's copy of the footprint sits: the best move, then a resize near it if that fits clearly better. */
function fitLayer(err: (scale: number, dx: number, dy: number) => number): Fit {
  let best: Fit = { offset: [0, 0], scale: 1, mae: err(1, 0, 0) };
  const tryFit = (scale: number, dx: number, dy: number) => {
    const m = err(scale, dx, dy);
    if (m < best.mae) best = { offset: [dx, dy], scale, mae: m };
  };
  for (let dy = -SHIFT; dy <= SHIFT; dy += SHIFT_STEP)
    for (let dx = -SHIFT; dx <= SHIFT; dx += SHIFT_STEP) tryFit(1, dx, dy);
  const moveOnly = best;
  const [bx, by] = best.offset;
  for (const scale of SCALES)
    for (let dy = by - SCALE_SHIFT; dy <= by + SCALE_SHIFT; dy += SHIFT_STEP)
      for (let dx = bx - SCALE_SHIFT; dx <= bx + SCALE_SHIFT; dx += SHIFT_STEP)
        tryFit(scale, dx, dy);
  return best.mae > SCALE_GAIN * moveOnly.mae ? moveOnly : best;
}

/** One moment: the original, the project with the layer and without it, all RGB at `w`x`h`. */
export function scoreLayerFrame(
  t: number,
  ref: Uint8Array,
  withLayer: Uint8Array,
  without: Uint8Array,
  w: number,
  h: number,
): LayerFrame {
  const idx = footprintOf(withLayer, without, w * h);
  if (idx.length < MIN_FOOTPRINT) return { t, footprint_px: idx.length };
  let [x0, x1, y0, y1] = [w, -1, h, -1];
  for (const i of idx) {
    const [x, y] = [i % w, Math.floor(i / w)];
    [x0, x1, y0, y1] = [Math.min(x0, x), Math.max(x1, x), Math.min(y0, y), Math.max(y1, y)];
  }
  const centre: [number, number] = [(x0 + x1) / 2, (y0 + y1) / 2];
  const head = {
    t,
    footprint_px: idx.length,
    bbox: [x0, y0, x1 - x0 + 1, y1 - y0 + 1] as [number, number, number, number],
    mae_with: round(mae(ref, withLayer, idx), 1),
    mae_without: round(mae(ref, without, idx), 1),
  };
  if (head.mae_without < REDUNDANT_MAE)
    return {
      ...head,
      benefit: null,
      note: "leaving the layer out already matches the original here: the original has nothing more there, or the footage carries its copy of the layer",
    };
  const step = Math.ceil(idx.length / FIT_SAMPLE);
  const sample = idx.filter((_, n) => n % step === 0);
  const xs = sample.map((i) => i % w);
  const ys = sample.map((i) => Math.floor(i / w));
  const fit = fitLayer((scale, dx, dy) =>
    mae(ref, withLayer, moved(xs, ys, w, h, centre, scale, dx, dy), sample),
  );
  return {
    ...head,
    benefit: round(1 - head.mae_with / head.mae_without, 3),
    fit: { ...fit, mae: round(fit.mae, 1) },
    instruction: instruction(fit.offset, fit.scale),
  };
}

export function layerVerdict(selector: string, frames: LayerFrame[]): LayerVerdict {
  const scored = frames.flatMap((f) => (typeof f.benefit === "number" ? [f.benefit] : []));
  const sorted = [...scored].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return {
    selector,
    frames,
    benefit_median: sorted.length
      ? round(sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2, 3)
      : null,
    worse: frames.filter((f) => typeof f.benefit === "number" && f.benefit < 0).map((f) => f.t),
    redundant: frames.filter((f) => f.benefit === null).map((f) => f.t),
  };
}
