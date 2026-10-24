// How a film moves over time, ported from the Studio's motion-rhythm.mjs: the share of frames where the picture
// changes, the still holds, the rate the animation updates at (on ones, twos, threes) and the camera's zoom and pan
// inside each shot. Zoom and pan are the dominant whole-frame transform every 0.5 s, so a large moving subject can
// read as camera; confirm a move on frames.
import { findCuts } from "./cuts.js";
import { meanAbsDiff, probeVideo, readFrames, round, type Roi } from "./media.js";

const CUT = 25;
const W = 160;

function bilinear(img: Uint8Array, w: number, h: number, x: number, y: number) {
  const [x0, y0] = [Math.floor(x), Math.floor(y)];
  if (x0 < 0 || y0 < 0 || x0 + 1 >= w || y0 + 1 >= h) return -1;
  const [fx, fy, i] = [x - x0, y - y0, y0 * w + x0];
  return (
    (img[i]! * (1 - fx) + img[i + 1]! * fx) * (1 - fy) +
    (img[i + w]! * (1 - fx) + img[i + w + 1]! * fx) * fy
  );
}

interface CameraStep {
  s: number;
  dx: number;
  dy: number;
  residual: number;
  still: number;
}

/** Best s, dx, dy with B(x) ≈ A(c + (x − c)/s + d): s > 1 is a push in. */
function cameraStep(a: Uint8Array, b: Uint8Array, w: number, h: number): CameraStep {
  const [cx, cy, m] = [w / 2, h / 2, Math.round(w * 0.1)];
  const cost = (s: number, dx: number, dy: number) => {
    let [sum, n] = [0, 0];
    for (let y = m; y < h - m; y += 2)
      for (let x = m; x < w - m; x += 2) {
        const v = bilinear(a, w, h, cx + (x - cx) / s + dx, cy + (y - cy) / s + dy);
        if (v >= 0) {
          sum += Math.abs(v - b[y * w + x]!);
          n++;
        }
      }
    return n ? sum / n : 1e9;
  };
  let best = [cost(1, 0, 0), 1, 0, 0];
  const search = (ss: number[], dxs: number[], dys: number[]) => {
    for (const s of ss)
      for (const dx of dxs)
        for (const dy of dys) {
          const c = cost(s, dx, dy);
          if (c < best[0]!) best = [c, s, dx, dy];
        }
  };
  const range = (c: number, step: number, n: number) =>
    Array.from({ length: 2 * n + 1 }, (_, i) => c + (i - n) * step);
  // coarse first, wide enough for a handheld swing (±10% zoom, ±10% of the width), then fine around the best
  search(range(1, 0.02, 5), range(0, 4, 4), range(0, 4, 4));
  search(range(best[1]!, 0.005, 2), range(best[2]!, 1, 2), range(best[3]!, 1, 2));
  search(range(best[1]!, 0.0025, 2), range(best[2]!, 0.5, 2), range(best[3]!, 0.5, 2));
  return { s: best[1]!, dx: best[2]!, dy: best[3]!, residual: best[0]!, still: cost(1, 0, 0) };
}

/** True when the whole frame moved: the best zoom and pan leave well under the change a still camera leaves. A
 * presenter swaying in front of a locked camera changes a small area, and moving it barely helps. */
const cameraMoved = (step: CameraStep) => step.residual < 0.7 * step.still;

interface Shot {
  start: number;
  end?: number;
  zoom: number;
  pan_x: number;
  pan_y: number;
  path: number;
  residuals: number[];
}

export interface Rhythm {
  start: number;
  seconds: number;
  fps: number;
  moving_share: number;
  longest_hold_s: number;
  median_hold_s: number;
  holds_over_1s_per_min: number;
  update_fps: number;
  still_threshold: number;
  cuts_per_min: number;
  camera_moves_per_min: number;
  shots: {
    start: number;
    end: number;
    camera: string;
    zoom: number;
    pan_x: number;
    pan_y: number;
    path: number;
  }[];
}

/** `still` is the reference's still threshold, so yours is measured at its level. */
// fallow-ignore-next-line complexity
export function rhythm(path: string, start = 0, seconds = 0, roi?: Roi, still?: number): Rhythm {
  const p = probeVideo(path);
  const secs = seconds || p.duration - start;
  const { frames: fs, h } = readFrames(path, { start, seconds: secs, roi, width: W, gray: true });
  const d = fs.slice(1).map((f, i) => meanAbsDiff(f, fs[i]!));
  // mean |Δluma| on a 160 px frame below which nothing visibly changed; grain and compression raise the floor
  // (capped, so a window that never stops moving is not read as noise)
  const STILL =
    still ??
    Math.min(
      1.5,
      Math.max(0.5, 2 * ([...d].sort((x, y) => x - y)[Math.floor(d.length * 0.1)] ?? 0)),
    );
  // Shots split where measure cuts and diff find cuts; CUT stays the ceiling of what counts as motion.
  const cuts = findCuts(fs).map((c) => c.frame);
  // a frame is moving when it or a neighbour changes, so animation on twos or threes still counts as motion
  const moving = d.map((_, i) =>
    [d[i - 1], d[i], d[i + 1]].some((v) => v !== undefined && v > STILL && v <= CUT),
  );
  const holds: number[] = [];
  for (let i = 0, run = 0; i <= moving.length; i++) {
    if (i < moving.length && !moving[i] && d[i]! <= CUT) run++;
    else {
      if (run) holds.push(run / p.fps);
      run = 0;
    }
  }
  // inside stretches that are moving, a repeated frame means the animation updates on twos or threes
  let [inMotion, repeats] = [0, 0];
  for (let i = 2; i < d.length - 2; i++) {
    const near = Math.max(d[i - 2]!, d[i - 1]!, d[i + 1]!, d[i + 2]!);
    if (near > STILL && near <= CUT) {
      inMotion++;
      if (d[i]! < 0.2 * near) repeats++;
    }
  }
  const step = Math.max(1, Math.round(p.fps / 2));
  const shots: Shot[] = [];
  const fresh = (t: number): Shot => ({
    start: t,
    zoom: 1,
    pan_x: 0,
    pan_y: 0,
    path: 0,
    residuals: [],
  });
  let shot = fresh(0);
  for (let i = 0; i + step < fs.length; i += step) {
    const cut = cuts.find((c) => c > i && c <= i + step);
    if (cut) {
      shots.push({ ...shot, end: cut / p.fps });
      shot = fresh(cut / p.fps);
      continue;
    }
    const c = cameraStep(fs[i]!, fs[i + step]!, W, h);
    shot.zoom *= c.s;
    shot.pan_x += c.dx / W;
    shot.pan_y += c.dy / h;
    if (cameraMoved(c)) shot.path += Math.hypot(c.dx / W, c.dy / h) + Math.abs(Math.log(c.s));
    shot.residuals.push(c.residual);
  }
  shots.push({ ...shot, end: fs.length / p.fps });
  // what is left after the best whole-frame transform; far above the film's usual level, the frame changed in a way
  // no zoom or pan explains (a swing past the search, a rotation, a large subject crossing the frame)
  const all = shots.flatMap((s) => s.residuals).sort((x, y) => x - y);
  const UNEXPLAINED = Math.max(12, 3 * (all[Math.floor(all.length / 2)] ?? 0));
  const kind = (s: Shot) => {
    if ((s.end ?? 0) - s.start < 0.6) return "short";
    const z = s.zoom - 1;
    if (Math.abs(z) > 0.03) return z > 0 ? "push in" : "pull out";
    if (Math.hypot(s.pan_x, s.pan_y) > 0.03) return "pan/drift";
    if (s.path > 0.08) return "handheld";
    if (s.residuals.some((r) => r > UNEXPLAINED)) return "moving, unexplained (confirm on frames)";
    return "static";
  };
  const sorted = [...holds].sort((x, y) => x - y);
  return {
    start,
    seconds: round(secs, 2),
    fps: round(p.fps, 2),
    moving_share: round(moving.filter(Boolean).length / Math.max(1, d.length), 2),
    longest_hold_s: round(sorted.at(-1) ?? 0, 2),
    median_hold_s: round(sorted[Math.floor(sorted.length / 2)] ?? 0, 2),
    holds_over_1s_per_min: round((holds.filter((x) => x >= 1).length / secs) * 60, 1),
    update_fps: round(p.fps * (1 - repeats / Math.max(1, inMotion)), 1),
    still_threshold: round(STILL, 2),
    cuts_per_min: round((cuts.length / secs) * 60, 1),
    camera_moves_per_min: round(
      (shots.filter((s) => /push|pull|pan|handheld/.test(kind(s))).length / secs) * 60,
      1,
    ),
    shots: shots.map((s) => ({
      start: round(start + s.start, 2),
      end: round(start + (s.end ?? 0), 2),
      camera: kind(s),
      zoom: round(s.zoom, 3),
      pan_x: round(s.pan_x, 3),
      pan_y: round(s.pan_y, 3),
      path: round(s.path, 3),
    })),
  };
}

const RATIO_KEYS = [
  "moving_share",
  "longest_hold_s",
  "median_hold_s",
  "holds_over_1s_per_min",
  "update_fps",
  "cuts_per_min",
  "camera_moves_per_min",
] as const;

/** Yours over the reference's, key by key; null where the reference's is 0. */
export function compareRhythm(ref: Rhythm, yours: Rhythm) {
  return Object.fromEntries(
    RATIO_KEYS.map((k) => [k, ref[k] ? round(yours[k] / ref[k], 2) : null]),
  );
}
