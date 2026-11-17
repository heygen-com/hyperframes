// The ease of one graphic move as numbers, ported from the Studio's motion-curve.mjs: inside an ROI, the element's
// box (centre, width, height) and its ink (mean difference from the background) on every frame, then for each
// property that changes, when the move starts and settles, the overshoot past its end value and the closest GSAP
// ease. Compared with a second window, a spring, a back-out or a slow expo is checked rather than eyeballed.
import { Fix, probeVideo, readFrames, round, type Roi } from "./media.js";

const W = 240;
export type Prop = "x" | "y" | "w" | "h" | "ink";
const PROPS: Prop[] = ["x", "y", "w", "h", "ink"];

/** One frame of an element: its box centre and size (video pixels) and ink; x and y are null when it is absent. */
export interface Row {
  t: number;
  x: number | null;
  y: number | null;
  w: number;
  h: number;
  ink: number;
}

type Ease = [name: string, f: (u: number) => number];
const pw = (k: number): Ease => [`power${k}.in`, (u) => u ** (k + 1)];
const pwo = (k: number): Ease => [`power${k}.out`, (u) => 1 - (1 - u) ** (k + 1)];
const pwio = (k: number): Ease => [
  `power${k}.inOut`,
  (u) => (u < 0.5 ? 2 ** k * u ** (k + 1) : 1 - (-2 * u + 2) ** (k + 1) / 2),
];
const back = (s: number): Ease => [
  `back.out(${s.toFixed(1)})`,
  (u) => 1 + (s + 1) * (u - 1) ** 3 + s * (u - 1) ** 2,
];
const elastic = (p: number): Ease => [
  `elastic.out(1,${p})`,
  (u) => (u <= 0 ? 0 : u >= 1 ? 1 : 2 ** (-10 * u) * Math.sin(((u - p / 4) * 2 * Math.PI) / p) + 1),
];
/** GSAP's named eases as functions of normalized time. */
export const EASES: Ease[] = [
  ["none", (u) => u],
  ...[1, 2, 3, 4].flatMap((k) => [pw(k), pwo(k), pwio(k)]),
  ["sine.out", (u) => Math.sin((u * Math.PI) / 2)],
  ["sine.inOut", (u) => -(Math.cos(Math.PI * u) - 1) / 2],
  ["expo.out", (u) => (u >= 1 ? 1 : 1 - 2 ** (-10 * u))],
  ["circ.out", (u) => Math.sqrt(1 - (u - 1) ** 2)],
  ...Array.from({ length: 26 }, (_, i) => back(0.5 + i * 0.1)),
  ...[0.2, 0.25, 0.3, 0.4, 0.5].map(elastic),
];

export interface FittedMove {
  prop: Prop;
  pulse?: undefined;
  from: number;
  to: number;
  start_s: number;
  duration_s: number;
  frames: number;
  overshoot_pct: number;
  anticipation_pct: number;
  ease: string;
  rmse: number;
  next: string[];
  /** 21 samples of normalized progress, for comparing two moves' shapes. */
  curve: number[];
}

/** A stretch that returns to where it began: its peak and length, no ease. */
export interface PulseMove {
  prop: Prop;
  pulse: true;
  from: number;
  peak: number;
  start_s: number;
  duration_s: number;
  frames: number;
}

export type Move = FittedMove | PulseMove;

/** Box and ink per frame of `roi`, against a flat background (the ROI border's median on the first frame, or `bg`). */
// fallow-ignore-next-line complexity
function track(
  path: string,
  start: number,
  seconds: number,
  roi: Roi,
  { bg = null, thr = 24 }: { bg?: number[] | null; thr?: number } = {},
): { fps: number; bg: number[]; rows: Row[] } {
  const fps = probeVideo(path).fps;
  const width = Math.min(W, roi[2]);
  const { frames: fs, h } = readFrames(path, { start, seconds, roi, width });
  const first = fs[0];
  if (!first)
    throw new Fix(
      `no frames between ${start}s and ${start + seconds}s`,
      "pick a window inside the video",
    );
  const k = roi[2] / width;
  let ref = bg;
  if (!ref) {
    const border: number[][] = [[], [], []];
    for (let y = 0; y < h; y++)
      for (let x = 0; x < width; x++)
        if (x < 2 || y < 2 || x >= width - 2 || y >= h - 2)
          for (let c = 0; c < 3; c++) border[c]!.push(first[(y * width + x) * 3 + c]!);
    ref = border.map((v) => v.sort((a, b) => a - b)[v.length >> 1]!);
  }
  const [r0, g0, b0] = [ref[0]!, ref[1]!, ref[2]!];
  const rows = fs.map((f, i): Row => {
    const xs: number[] = [];
    const ys: number[] = [];
    let ink = 0;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < width; x++) {
        const j = (y * width + x) * 3;
        const d = Math.max(
          Math.abs(f[j]! - r0),
          Math.abs(f[j + 1]! - g0),
          Math.abs(f[j + 2]! - b0),
        );
        ink += d;
        if (d > thr) {
          xs.push(x);
          ys.push(y);
        }
      }
    const t = round(start + i / fps, 3);
    if (xs.length < 4) return { t, x: null, y: null, w: 0, h: 0, ink: round(ink / (width * h), 2) };
    xs.sort((a, b) => a - b);
    ys.sort((a, b) => a - b);
    const q = (v: number[], p: number) => v[Math.min(v.length - 1, Math.floor(v.length * p))]!;
    const [x0, x1, y0, y1] = [q(xs, 0.01), q(xs, 0.99), q(ys, 0.01), q(ys, 0.99)];
    return {
      t,
      x: round(roi[0] + ((x0 + x1 + 1) / 2) * k, 1),
      y: round(roi[1] + ((y0 + y1 + 1) / 2) * k, 1),
      w: round((x1 - x0 + 1) * k, 1),
      h: round((y1 - y0 + 1) * k, 1),
      ink: round(ink / (width * h), 2),
    };
  });
  return { fps, bg: ref, rows };
}

/** Fit one stretch of values from its start value to its settled end value. */
function fit(
  rows: readonly Row[],
  idx: number[],
  v: number[],
  prop: Prop,
  fps: number,
  a: number,
  b: number,
): FittedMove {
  const [v0, v1] = [v[a]!, v[b]!];
  const span = v1 - v0;
  const p = v.slice(a, b + 1).map((x) => (x - v0) / span);
  const u = p.map((_, i) => i / Math.max(1, p.length - 1));
  const fits = EASES.map(([name, f]) => ({
    name,
    rmse: Math.sqrt(p.reduce((s, x, i) => s + (x - f(u[i]!)) ** 2, 0) / p.length),
  })).sort((m, n) => m.rmse - n.rmse);
  return {
    prop,
    from: round(v0, 1),
    to: round(v1, 1),
    start_s: rows[idx[a]!]!.t,
    duration_s: round((idx[b]! - idx[a]!) / fps, 3),
    frames: idx[b]! - idx[a]!,
    overshoot_pct: round(Math.max(0, Math.max(...p) - 1) * 100, 1),
    anticipation_pct: round(Math.max(0, -Math.min(...p)) * 100, 1),
    ease: fits[0]!.name,
    rmse: round(fits[0]!.rmse, 3),
    next: fits.slice(1, 3).map((f) => `${f.name} ${round(f.rmse, 3)}`),
    curve: Array.from({ length: 21 }, (_, i) =>
      round(p[Math.round((i / 20) * (p.length - 1))]!, 3),
    ),
  };
}

/** Every move of one property: stretches of change separated by holds of 0.15 s or more (shorter stills are the
 * turn at an overshoot's peak). A stretch that returns to where it began is a pulse (peak and length, no ease). */
// fallow-ignore-next-line complexity
export function fitMoves(
  rows: readonly Row[],
  prop: Prop,
  fps: number,
  minChange: number,
  quant: number,
): Move[] {
  const idx = rows.flatMap((r, i) => (r[prop] == null ? [] : [i]));
  const v = idx.map((i) => rows[i]![prop] ?? 0);
  const out: Move[] = [];
  for (let i = 0; i < v.length - 1; ) {
    if (Math.abs(v[i + 1]! - v[i]!) <= quant) {
      i++;
      continue;
    }
    const hold = Math.max(3, Math.round(0.15 * fps));
    let [b, still] = [i + 1, 0];
    for (let j = i + 1; j < v.length - 1 && still < hold; j++)
      if (Math.abs(v[j + 1]! - v[j]!) <= quant) still++;
      else [still, b] = [0, j + 1];
    const span = v[b]! - v[i]!;
    const peak = v
      .slice(i, b + 1)
      .reduce((m, x) => (Math.abs(x - v[i]!) > Math.abs(m - v[i]!) ? x : m), v[i]!);
    // a creep of under 3% of the move before it really starts is compression noise, not the move
    let a = i;
    while (a < b - 2 && Math.abs(v[a + 1]! - v[a]!) < 0.03 * Math.abs(span)) a++;
    if (Math.abs(span) >= minChange) out.push(fit(rows, idx, v, prop, fps, a, b));
    else if (Math.abs(peak - v[i]!) >= minChange)
      out.push({
        prop,
        pulse: true,
        from: round(v[i]!, 1),
        peak: round(peak, 1),
        start_s: rows[idx[i]!]!.t,
        duration_s: round((idx[b]! - idx[i]!) / fps, 3),
        frames: idx[b]! - idx[i]!,
      });
    i = b;
  }
  return out;
}

export interface Curves {
  start: number;
  seconds: number;
  roi: Roi;
  fps: number;
  bg: number[];
  moves: Move[];
}

/** Every move of the element in `roi`, sorted by start. */
export function curves(
  path: string,
  start: number,
  seconds: number,
  roi: Roi,
  opts: { bg?: number[] | null; thr?: number } = {},
): Curves {
  const { fps, bg, rows } = track(path, start, seconds, roi, opts);
  const minPx = 0.02 * Math.max(roi[2], roi[3]);
  const step = roi[2] / Math.min(W, roi[2]);
  const moves = PROPS.flatMap((k) =>
    k === "ink" ? fitMoves(rows, k, fps, 2, 0.5) : fitMoves(rows, k, fps, minPx, step),
  ).sort((m, n) => m.start_s - n.start_s);
  return { start, seconds, roi, fps: round(fps, 2), bg, moves };
}

export interface MoveComparison {
  prop: Prop;
  at_s: number;
  yours?: "no matching move";
  start_offset_s?: number;
  duration_frames?: string;
  pulse?: true;
  peak?: string;
  ease?: string;
  same_family?: boolean;
  overshoot_pct?: string;
  curve_rmse?: number;
}

/** Pair each reference move with your move of the same property that starts closest on the window's clock. */
export function compareCurves(ref: Curves, yours: Curves): MoveComparison[] {
  const family = (s: string) => s.replace(/\(.*\)/, "").replace(/\d/, "");
  return ref.moves.map((m) => {
    const rel = m.start_s - ref.start;
    const d = yours.moves
      .filter((x) => x.prop === m.prop && !!x.pulse === !!m.pulse)
      .sort(
        (x, y) => Math.abs(x.start_s - yours.start - rel) - Math.abs(y.start_s - yours.start - rel),
      )[0];
    const head = { prop: m.prop, at_s: round(rel, 2) };
    if (!d) return { ...head, yours: "no matching move" };
    const common = {
      ...head,
      start_offset_s: round(d.start_s - yours.start - rel, 3),
      duration_frames: `${m.frames} → ${d.frames}`,
    };
    if (m.pulse || d.pulse)
      return {
        ...common,
        pulse: true,
        peak: `${m.pulse ? m.peak : m.to} → ${d.pulse ? d.peak : d.to}`,
      };
    return {
      ...common,
      ease: `${m.ease} → ${d.ease}`,
      same_family: family(m.ease) === family(d.ease),
      overshoot_pct: `${m.overshoot_pct} → ${d.overshoot_pct}`,
      curve_rmse: round(
        Math.sqrt(m.curve.reduce((s, x, i) => s + (x - d.curve[i]!) ** 2, 0) / m.curve.length),
        3,
      ),
    };
  });
}

/** Moves as printed: the shape samples stay internal. */
export const printable = (moves: Move[]) =>
  moves.map((m) => (m.pulse ? m : { ...m, curve: undefined }));
