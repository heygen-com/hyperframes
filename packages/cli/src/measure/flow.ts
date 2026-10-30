// Dense optical flow inside one element's box, ported from hf-media's flow.py. Two uses: comparing a rebuild with
// its original on one clock (motion energy, the shape of the motion over time, path, scale and rotation; fonts and
// content do not move these numbers as they do SSIM), and reversing a move into tweens. hf-media's DIS flow is not in
// opencv.js, so this is Farneback's; thresholds carry over but are calibrated on the reverse bench.
import { EASES } from "./curve.js";
import { readClip, round, videoClip, type Roi, type VideoInfo } from "./media.js";
import { greyMat, loadOpenCv } from "./opencv.js";

// Below this mean flow (pixels a frame at the analysis size) a frame counts as still.
const STILL = 0.05;
// Flow under this magnitude is noise for the affine fit.
const FIT_MIN = 0.3;
// Flow needs room for its windows: thin boxes are read taller.
const MIN_HEIGHT = 64;

export interface FlowRow {
  mag: number;
  share: number;
  tx: number;
  ty: number;
  scale: number;
  rot: number;
}

/** Per pair of frames: mean flow, the share of moving pixels, and the affine of the moving part. */
// fallow-ignore-next-line complexity
export async function flowSeries(
  info: VideoInfo,
  start: number,
  end: number,
  roi: Roi,
  maxWidth: number,
): Promise<FlowRow[]> {
  const cv = await loadOpenCv((m) => console.error(m));
  let width = Math.min(maxWidth, roi[2]);
  if ((width * roi[3]) / roi[2] < MIN_HEIGHT) width = Math.ceil((MIN_HEIGHT * roi[2]) / roi[3]);
  const { frames, w, h } = readClip(videoClip(info.path, start, end - start, info), {
    roi,
    width,
    gray: true,
  });
  const rows: FlowRow[] = [];
  const grid: number[] = [];
  for (let y = 0; y < h; y += 4) for (let x = 0; x < w; x += 4) grid.push(x, y);
  for (let i = 1; i < frames.length; i++) {
    const [a, b, flow] = [
      greyMat(cv, frames[i - 1]!, w, h),
      greyMat(cv, frames[i]!, w, h),
      new cv.Mat(),
    ];
    try {
      cv.calcOpticalFlowFarneback(a, b, flow, 0.5, 5, 25, 3, 7, 1.5, 0);
      const f = flow.data32F;
      let [sum, moving] = [0, 0];
      for (let p = 0; p < w * h; p++) {
        const m = Math.hypot(f[2 * p]!, f[2 * p + 1]!);
        sum += m;
        if (m > FIT_MIN) moving++;
      }
      const row: FlowRow = {
        mag: sum / (w * h),
        share: moving / (w * h),
        tx: 0,
        ty: 0,
        scale: 1,
        rot: 0,
      };
      const from: number[] = [];
      const to: number[] = [];
      for (let g = 0; g < grid.length; g += 2) {
        const p = grid[g + 1]! * w + grid[g]!;
        const [dx, dy] = [f[2 * p]!, f[2 * p + 1]!];
        if (Math.hypot(dx, dy) <= FIT_MIN) continue;
        from.push(grid[g]!, grid[g + 1]!);
        to.push(grid[g]! + dx, grid[g + 1]! + dy);
      }
      if (from.length >= 24) {
        const fit = similarity(from, to);
        if (fit)
          Object.assign(row, { tx: fit.tx / w, ty: fit.ty / h, scale: fit.scale, rot: fit.rot });
      }
      rows.push(row);
    } finally {
      for (const mat of [a, b, flow]) mat.delete();
    }
  }
  return rows;
}

interface Similarity {
  a: number;
  b: number;
  tx: number;
  ty: number;
}

/** Least squares in closed form over the points `keep`. */
function fitSimilarity(from: number[], to: number[], keep: number[]): Similarity | null {
  let [px, py, qx, qy] = [0, 0, 0, 0];
  for (const i of keep) {
    px += from[2 * i]!;
    py += from[2 * i + 1]!;
    qx += to[2 * i]!;
    qy += to[2 * i + 1]!;
  }
  [px, py, qx, qy] = [px / keep.length, py / keep.length, qx / keep.length, qy / keep.length];
  let [sa, sb, ss] = [0, 0, 0];
  for (const i of keep) {
    const [ux, uy, vx, vy] = [
      from[2 * i]! - px,
      from[2 * i + 1]! - py,
      to[2 * i]! - qx,
      to[2 * i + 1]! - qy,
    ];
    sa += ux * vx + uy * vy;
    sb += ux * vy - uy * vx;
    ss += ux * ux + uy * uy;
  }
  if (ss < 1e-9) return null;
  const [a, b] = [sa / ss, sb / ss];
  return { a, b, tx: qx - (a * px - b * py), ty: qy - (b * px + a * py) };
}

const residual = (f: Similarity, from: number[], to: number[], i: number) =>
  Math.hypot(
    f.a * from[2 * i]! - f.b * from[2 * i + 1]! + f.tx - to[2 * i]!,
    f.b * from[2 * i]! + f.a * from[2 * i + 1]! + f.ty - to[2 * i + 1]!,
  );

/**
 * The scale, rotation and translation the most points agree on (`from` and `to` are flat x,y lists): RANSAC over
 * two-point hypotheses with a fixed seed, then least squares on the inliers. opencv.js has no
 * estimateAffinePartial2D, and a plain fit is pulled off by the smeared flow at a moving element's edges.
 */
export function similarity(
  from: number[],
  to: number[],
): { tx: number; ty: number; scale: number; rot: number } | null {
  const n = from.length / 2;
  let seed = 1709;
  const pick = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed % n;
  };
  let best: number[] = [];
  for (let k = 0; k < 200; k++) {
    const [i, j] = [pick(), pick()];
    if (i === j) continue;
    const f = fitSimilarity(from, to, [i, j]);
    if (!f) continue;
    const inliers: number[] = [];
    for (let p = 0; p < n; p++) if (residual(f, from, to, p) <= 1) inliers.push(p);
    if (inliers.length > best.length) best = inliers;
  }
  if (best.length < Math.max(6, 0.2 * n)) return null;
  const fit = fitSimilarity(from, to, best);
  if (!fit) return null;
  return {
    tx: fit.tx,
    ty: fit.ty,
    scale: Math.hypot(fit.a, fit.b),
    rot: (Math.atan2(fit.b, fit.a) * 180) / Math.PI,
  };
}

/** The best Pearson r of two curves within ±3 frames, and its lag. */
function corr(a: number[], b: number[]): [number | null, number] {
  let best: [number | null, number] = [null, 0];
  for (let lag = -3; lag <= 3; lag++) {
    const x = a.slice(Math.max(0, -lag), a.length - Math.max(0, lag));
    const y = b.slice(Math.max(0, lag), b.length - Math.max(0, -lag));
    const n = Math.min(x.length, y.length);
    if (n < 4) continue;
    const mx = x.slice(0, n).reduce((s, v) => s + v, 0) / n;
    const my = y.slice(0, n).reduce((s, v) => s + v, 0) / n;
    let [sxy, sx, sy] = [0, 0, 0];
    for (let i = 0; i < n; i++) {
      sxy += (x[i]! - mx) * (y[i]! - my);
      sx += (x[i]! - mx) ** 2;
      sy += (y[i]! - my) ** 2;
    }
    if (sx < 1e-18 || sy < 1e-18) continue;
    const c = sxy / Math.sqrt(sx * sy);
    if (best[0] === null || c > best[0]) best = [c, lag];
  }
  return best;
}

/** Yours against the original, frame for frame on one clock. */
export function compareFlow(ref: FlowRow[], yours: FlowRow[]) {
  const n = Math.min(ref.length, yours.length);
  const [a, b] = [ref.slice(0, n), yours.slice(0, n)];
  const energy = (rows: FlowRow[]) =>
    rows.reduce((s, r) => s + r.mag, 0) / Math.max(1, rows.length);
  const [re, ye] = [energy(a), energy(b)];
  const still = re < STILL;
  const ratio = still ? (ye < STILL ? 1 : null) : ye / re;
  const [c, lag] = corr(
    a.map((r) => r.mag),
    b.map((r) => r.mag),
  );
  const mean = (v: number[]) => v.reduce((s, x) => s + x, 0) / Math.max(1, v.length);
  return {
    frames: n,
    original_still: still,
    original_energy: round(re, 3),
    yours_energy: round(ye, 3),
    energy_ratio: ratio === null ? null : round(ratio, 3),
    motion_corr: c === null ? null : round(c, 3),
    lag_frames: lag,
    path_error: round(
      mean(a.map((r, i) => Math.abs(r.tx - b[i]!.tx) + Math.abs(r.ty - b[i]!.ty))),
      4,
    ),
    scale_error: round(mean(a.map((r, i) => Math.abs(r.scale - b[i]!.scale))), 4),
    rotation_error: round(mean(a.map((r, i) => Math.abs(r.rot - b[i]!.rot))), 3),
  };
}

function fitEase(progress: number[]): [string, number] {
  const n = progress.length;
  let best: [string, number] = ["none", Infinity];
  for (const [name, f] of EASES) {
    const err = progress.reduce((s, p, i) => s + (f(i / Math.max(1, n - 1)) - p) ** 2, 0) / n;
    if (err < best[1]) best = [name, err];
  }
  return [best[0], round(Math.sqrt(best[1]), 4)];
}

/** Moves between holds, each as a tween: when, how far (source pixels), scale, rotation, ease and overshoot. */
// fallow-ignore-next-line complexity
export function flowMoves(rows: FlowRow[], fps: number, [, , w, h]: Roi, start: number) {
  const pos: [number, number, number, number][] = [[0, 0, 1, 0]];
  for (const r of rows) {
    const [x, y, s, a] = pos.at(-1)!;
    pos.push([x + r.tx * w, y + r.ty * h, s * r.scale, a + r.rot]);
  }
  // A frame belongs to a move when the element itself shifts, scales or turns, however slowly it eases out.
  const active = rows.map(
    (r) =>
      Math.hypot(r.tx * w, r.ty * h) >= 0.25 ||
      Math.abs(r.scale - 1) >= 0.003 ||
      Math.abs(r.rot) >= 0.15,
  );
  const moves: Record<string, unknown>[] = [];
  for (let i = 0; i < active.length; ) {
    if (!active[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < active.length && (active[j + 1] || (j + 2 < active.length && active[j + 2])))
      j++;
    const [s0, s1] = [pos[i]!, pos[j + 1]!];
    const [dx, dy] = [s1[0] - s0[0], s1[1] - s0[1]];
    const along = pos
      .slice(i, j + 2)
      .map((p) => (Math.abs(dx) >= Math.abs(dy) ? p[0] - s0[0] : p[1] - s0[1]));
    const total = Math.abs(dx) >= Math.abs(dy) ? dx : dy;
    const ds = s1[2] - s0[2];
    const progress =
      Math.abs(total) >= 1
        ? along.map((v) => v / total)
        : pos.slice(i, j + 2).map((p) => (Math.abs(ds) > 1e-3 ? (p[2] - s0[2]) / ds : 0));
    const head = {
      start_s: round(start + i / fps, 3),
      x: round(dx, 1),
      y: round(dy, 1),
      scale: round(s1[2] / s0[2], 3),
    };
    if (j === i) moves.push({ kind: "jump", ...head });
    else {
      const [ease, err] = fitEase(progress);
      moves.push({
        kind: "tween",
        ...head,
        duration_s: round((j + 1 - i) / fps, 3),
        rotation: round(s1[3] - s0[3], 2),
        ease,
        ease_error: err,
        overshoot: round(Math.max(0, Math.max(...progress) - 1), 3),
      });
    }
    i = j + 1;
  }
  return moves;
}
