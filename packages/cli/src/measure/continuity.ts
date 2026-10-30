// Seams a rebuild has and its original does not, ported from the Studio's hf-media continuity: on the original's
// clock, a jump (a whole-frame change the original lacks), flicker (a change over background the original keeps
// still) and structure (an extra, missing or misplaced shape, from blurred edge maps). Screening candidates: open each
// event's sheet before acting. The per-pixel work is plain TypeScript so it needs no OpenCV download.
import { join } from "node:path";
import { decode, Fix, frameAt, probeVideo, round, writeImage, type VideoInfo } from "./media.js";

const WIDTH = 160;
const NEIGHBOURS = 2; // a spike must beat the original's max within ±this many frames
const STATIC_WINDOW = 12; // still mask: the original's per-pixel change stays low for ±this many frames ...
const STATIC_LEVEL = 6; // ... below this level
const STATIC_MIN_SHARE = 0.05; // fewer still pixels than this share: no flicker reading at that frame
const [JUMP_ABS, JUMP_RATIO] = [3, 2];
const [FLICKER_ABS, FLICKER_RATIO, FLICKER_LOCAL] = [2, 3, 1.8];
const STRUCTURE_K = 4; // a structure spike is above the film's median + k × MAD ...
const STRUCTURE_LOCAL = 1.5; // ... above this multiple of its median within ±1 s ...
const STRUCTURE_MIN = 1.5; // ... and above this floor (mean-normalised edge difference)
const STRUCTURE_BOX = 0.15; // local window of the structure difference, share of the width
const EVENT_GAP = 2;

export type ContinuityKind = "jump" | "flicker" | "structure";

/** Convolves rows then columns with kernel `k` (odd length), clamping at the edges and dividing by its sum. */
function separable(src: Float32Array, w: number, h: number, k: number[]): Float32Array {
  const r = (k.length - 1) / 2;
  const sum = k.reduce((s, v) => s + v, 0);
  const pass = (a: Float32Array, horizontal: boolean) => {
    const out = new Float32Array(a.length);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        let s = 0;
        for (let i = -r; i <= r; i++) {
          const xx = horizontal ? Math.min(w - 1, Math.max(0, x + i)) : x;
          const yy = horizontal ? y : Math.min(h - 1, Math.max(0, y + i));
          s += a[yy * w + xx]! * k[i + r]!;
        }
        out[y * w + x] = s / sum;
      }
    return out;
  };
  return pass(pass(src, true), false);
}

/** Separable Gaussian with clamped edges; cv2.GaussianBlur with sigma and an automatic kernel, near enough. */
function gaussian(src: Float32Array, w: number, h: number, sigma: number): Float32Array {
  const r = Math.ceil(3 * sigma);
  const k = Array.from({ length: 2 * r + 1 }, (_, i) =>
    Math.exp(-((i - r) ** 2) / (2 * sigma * sigma)),
  );
  return separable(src, w, h, k);
}

/** Box mean over a size×size window with clamped edges (cv2.blur). */
function box(src: Float32Array, w: number, h: number, size: number): Float32Array {
  return separable(src, w, h, new Array<number>(2 * Math.floor(size / 2) + 1).fill(1));
}

/** Blurred edge strength: Gaussian σ1, 3×3 Sobel magnitude, Gaussian σ2. */
function edges(g: Uint8Array, w: number, h: number): Float32Array {
  const b = gaussian(Float32Array.from(g), w, h, 1);
  const at = (x: number, y: number) =>
    b[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))]!;
  const mag = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const gx =
        at(x + 1, y - 1) +
        2 * at(x + 1, y) +
        at(x + 1, y + 1) -
        at(x - 1, y - 1) -
        2 * at(x - 1, y) -
        at(x - 1, y + 1);
      const gy =
        at(x - 1, y + 1) +
        2 * at(x, y + 1) +
        at(x + 1, y + 1) -
        at(x - 1, y - 1) -
        2 * at(x, y - 1) -
        at(x + 1, y - 1);
      mag[y * w + x] = Math.hypot(gx, gy);
    }
  return gaussian(mag, w, h, 2);
}

const mean = (a: ArrayLike<number>) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]!;
  return s / (a.length || 1);
};
const median = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
};

interface Row {
  frame: number;
  original_change: number | null;
  change: number | null;
  original_static_change: number | null;
  static_change: number | null;
  structure: number;
  at: [number, number];
}

export interface ContinuityEvent {
  kind: ContinuityKind;
  start_s: number;
  end_s: number;
  peak_s: number;
  peak_frame: number;
  value: number;
  original_value: number | null;
  at?: [number, number];
  sheet: string;
}

/** The original's frames [a, b) and yours on the original's clock, grey at WIDTH. */
function frames(path: string, a: number, b: number, h: number, fps?: string): Uint8Array[] {
  const select = `select=between(n\\,${a}\\,${b - 1})`;
  const filters = [
    ...(fps ? [`fps=${fps}`] : []),
    select,
    `setpts=N/(${fps ?? "1"})/TB`,
    `scale=${WIDTH}:${h}`,
  ];
  return decode(["-i", path], filters, WIDTH, h, true).frames;
}

/** One sheet: the original's frames over yours, the peak marked by a white bar under it. */
function sheet(
  orig: Uint8Array[],
  yours: Uint8Array[],
  w: number,
  h: number,
  peak: number,
  out: string,
) {
  const W = orig.length * (w + 4);
  const H = 2 * h + 12;
  const px = new Uint8Array(W * H).fill(30);
  orig.forEach((f, i) => {
    for (let y = 0; y < h; y++) {
      px.set(f.subarray(y * w, (y + 1) * w), y * W + i * (w + 4));
      px.set(yours[i]!.subarray(y * w, (y + 1) * w), (h + 6 + y) * W + i * (w + 4));
    }
    if (i === peak)
      for (let y = 2 * h + 8; y < H; y++)
        px.fill(255, y * W + i * (w + 4), y * W + i * (w + 4) + w);
  });
  return writeImage(out, px, W, H, true);
}

// fallow-ignore-next-line complexity
export function continuity(
  reference: string,
  yoursPath: string,
  opts: { start?: number; end?: number; outDir: string },
): { events: ContinuityEvent[]; thresholds: Record<string, number>; frames: number } {
  const ref: VideoInfo = probeVideo(reference);
  const yoursInfo = probeVideo(yoursPath);
  const h = Math.max(2, Math.round((ref.height * WIDTH) / ref.width / 2) * 2);
  const k0 = frameAt(opts.start ?? 0, ref.fps);
  const k1 = Math.min(ref.frames, Math.ceil((opts.end ?? ref.duration) * ref.fps - 1e-6));
  const yours = frames(yoursInfo.path, k0, k1, h, ref.fpsText);
  if (yours.length < 3)
    throw new Fix(
      "fewer than three frames of yours fall in the window",
      "widen --start/--end, or check yours plays that long",
    );
  const low = Math.max(0, k0 - STATIC_WINDOW - 1);
  const high = Math.min(ref.frames, k0 + yours.length + STATIC_WINDOW + 1);
  const stack = frames(ref.path, low, high, h, ref.fpsText);
  const n = WIDTH * h;
  const moved = stack.map((f, k) => {
    const d = new Uint8Array(n);
    if (k) for (let i = 0; i < n; i++) d[i] = Math.abs(f[i]! - stack[k - 1]![i]!);
    return d;
  });
  const boxSize = Math.max(3, Math.round(STRUCTURE_BOX * WIDTH));
  const scale = ref.width / WIDTH;
  const rows: Row[] = [];
  for (let m = 0; m < yours.length; m++) {
    const j = k0 + m;
    const k = j - low;
    if (!stack[k]) break;
    // Still pixels: the original's change stays under STATIC_LEVEL for ±STATIC_WINDOW frames.
    const mask = new Uint8Array(n).fill(1);
    for (
      let q = Math.max(0, k - STATIC_WINDOW);
      q <= Math.min(stack.length - 1, k + STATIC_WINDOW);
      q++
    )
      for (let i = 0; i < n; i++) if (moved[q]![i]! >= STATIC_LEVEL) mask[i] = 0;
    const [a, b] = [edges(stack[k]!, WIDTH, h), edges(yours[m]!, WIDTH, h)];
    const norm = (mean(a) + mean(b)) / 2 + 1e-6;
    const diff = box(
      a.map((v, i) => Math.abs(v - b[i]!) / norm),
      WIDTH,
      h,
      boxSize,
    );
    let best = 0;
    for (let i = 1; i < n; i++) if (diff[i]! > diff[best]!) best = i;
    const row: Row = {
      frame: j,
      original_change: j > 0 && k > 0 ? mean(moved[k]!) : null,
      change: null,
      original_static_change: null,
      static_change: null,
      structure: diff[best]!,
      at: [Math.round((best % WIDTH) * scale), Math.round(Math.floor(best / WIDTH) * scale)],
    };
    if (m > 0 && k > 0) {
      const prev = yours[m - 1]!;
      let [all, still, stillOrig, count] = [0, 0, 0, 0];
      for (let i = 0; i < n; i++) {
        const d = Math.abs(yours[m]![i]! - prev[i]!);
        all += d;
        if (mask[i]) {
          still += d;
          stillOrig += moved[k]![i]!;
          count++;
        }
      }
      row.change = all / n;
      if (count / n >= STATIC_MIN_SHARE) {
        row.static_change = still / count;
        row.original_static_change = stillOrig / count;
      }
    }
    rows.push(row);
  }

  const around = (key: keyof Row, at: number, reach: number, reduce: (v: number[]) => number) => {
    const v = rows
      .slice(Math.max(0, at - reach), at + reach + 1)
      .map((r) => r[key])
      .filter((x): x is number => typeof x === "number");
    return v.length ? reduce(v) : null;
  };
  const structures = rows.map((r) => r.structure);
  const med = median(structures);
  const mad = Math.max(median(structures.map((s) => Math.abs(s - med))), 0.05 * med);
  const structureThreshold = Math.max(STRUCTURE_MIN, med + STRUCTURE_K * mad);
  const localReach = Math.max(1, Math.round(ref.fps));
  const flagged: { at: number; kind: ContinuityKind; value: number; base: number | null }[] = [];
  // fallow-ignore-next-line complexity
  rows.forEach((r, i) => {
    if (r.change !== null) {
      const base = around("original_change", i, NEIGHBOURS, (v) => Math.max(...v)) ?? 0;
      if (r.change > Math.max(base + JUMP_ABS, base * JUMP_RATIO))
        flagged.push({ at: i, kind: "jump", value: r.change, base });
      else if (r.static_change !== null) {
        const sb = around("original_static_change", i, NEIGHBOURS, (v) => Math.max(...v)) ?? 0;
        const own = around("static_change", i, STATIC_WINDOW, median) ?? 0;
        if (r.static_change > Math.max(sb + FLICKER_ABS, sb * FLICKER_RATIO, own * FLICKER_LOCAL))
          flagged.push({ at: i, kind: "flicker", value: r.static_change, base: sb });
      }
    }
    if (
      r.structure > structureThreshold &&
      r.structure > STRUCTURE_LOCAL * (around("structure", i, localReach, median) ?? 0)
    )
      flagged.push({ at: i, kind: "structure", value: r.structure, base: med });
  });

  // Flagged frames of one kind within EVENT_GAP of each other are one event, peaking at its largest value.
  const groups: {
    kind: ContinuityKind;
    first: number;
    last: number;
    peak: number;
    value: number;
    base: number | null;
  }[] = [];
  for (const kind of ["jump", "flicker", "structure"] as const) {
    let open: (typeof groups)[number] | null = null;
    for (const f of flagged.filter((x) => x.kind === kind)) {
      if (open && f.at - open.last <= EVENT_GAP) {
        open.last = f.at;
        if (f.value > open.value) Object.assign(open, { peak: f.at, value: f.value, base: f.base });
        continue;
      }
      open = { kind, first: f.at, last: f.at, peak: f.at, value: f.value, base: f.base };
      groups.push(open);
    }
  }
  groups.sort((x, y) => x.first - y.first);
  const t = (i: number) => round(rows[i]!.frame / ref.fps, 3);
  const events = groups.map((g, number) => {
    const shown = [g.peak - 2, g.peak - 1, g.peak, g.peak + 1].filter(
      (i) => i >= 0 && i < rows.length,
    );
    const path = sheet(
      shown.map((i) => stack[rows[i]!.frame - low]!),
      shown.map((i) => yours[i]!),
      WIDTH,
      h,
      shown.indexOf(g.peak),
      join(
        opts.outDir,
        `event-${String(number + 1).padStart(2, "0")}-${g.kind}-${rows[g.peak]!.frame}.png`,
      ),
    );
    return {
      kind: g.kind,
      start_s: t(g.first),
      end_s: t(g.last),
      peak_s: t(g.peak),
      peak_frame: rows[g.peak]!.frame,
      value: round(g.value, 2),
      original_value: g.base === null ? null : round(g.base, 2),
      ...(g.kind === "structure" ? { at: rows[g.peak]!.at } : {}),
      sheet: path,
    };
  });
  return {
    events,
    frames: rows.length,
    thresholds: {
      jump_abs: JUMP_ABS,
      jump_ratio: JUMP_RATIO,
      flicker_abs: FLICKER_ABS,
      flicker_ratio: FLICKER_RATIO,
      structure: round(structureThreshold, 3),
      structure_median: round(med, 3),
    },
  };
}
