// How big the face is and where, ported from hf-media's face_size: OpenCV's frontal and profile Haar cascades on
// evenly spaced frames, graded by face height over frame height. A regenerated presenter keeps the likeness from
// FACE_HOLDS up; below FACE_FLOOR a video model cannot carry one at all (the harness's face-size eval, 2026-10-08).
import { frameAt, round, runFfmpeg, type VideoInfo } from "./media.js";
import { greyMat, loadOpenCv } from "./opencv.js";

const FACE_HOLDS = 0.25;
const FACE_SLIDES = 0.15;
const FACE_FLOOR = 0.06;
/**
 * The smallest face looked for by default, as a share of the frame's height: well under FACE_FLOOR, and it skips the
 * cascades' costliest windows. A minimum on their ladder keeps the full search's boxes; scaling the frame moves them.
 */
const FACE_MIN = 0.04;
const WORK_W = 960;
const STEP = 1.1;
const WINDOW_PX = 20;
// Samples closer than this share one decode from the first of them; farther ones get a seek of their own.
const RUN_S = 2;

type Verdict = "pass" | "warn" | "fail" | "unmeasured";
const ORDER: Verdict[] = ["fail", "unmeasured", "warn", "pass"];

export function faceVerdict(height: number | null, cast = false): Verdict {
  if (height === null) return "unmeasured";
  if (height >= FACE_HOLDS) return "pass";
  return height < (cast ? FACE_SLIDES : FACE_FLOOR) ? "fail" : "warn";
}

/** `samples` frame indices spread evenly over [start, end), the last frame included. */
export function sampleFrames(fps: number, start: number, end: number, samples: number): number[] {
  const k0 = frameAt(start, fps);
  const k1 = Math.max(k0, Math.ceil(end * fps - 1e-6) - 1);
  const n = Math.min(samples, k1 - k0 + 1);
  return [
    ...new Set(
      Array.from({ length: n }, (_, i) => k0 + Math.round((i * (k1 - k0)) / Math.max(1, n - 1))),
    ),
  ];
}

/** The largest window on the cascades' 20 px x 1.1^k ladder that is no more than `share` of a frame `h` high. */
export function minWindow(h: number, share: number): number {
  const steps = Math.floor(Math.log(Math.max(1, (share * h) / WINDOW_PX)) / Math.log(STEP) + 1e-9);
  return Math.round(WINDOW_PX * STEP ** steps);
}

/** Frames `ks` (indices from the first) as grey bytes at `w` x `h`, keeping the video's aspect. Each run of nearby
 * frames is one ffmpeg pass from its first frame to its last; a variable-rate video, which a seek can't index, is read
 * from its start. */
export function readSamples(info: VideoInfo, ks: number[], w: number, h: number): Uint8Array[] {
  const runs: number[][] = [];
  for (const k of ks) {
    const run = runs.at(-1);
    if (run && (info.vfr || (k - run.at(-1)!) / info.fps <= RUN_S)) run.push(k);
    else runs.push([k]);
  }
  const size = w * h;
  return runs.flatMap((run) => {
    // Half a frame early: an input seek drops the frames before it, so the first one left is frame run[0].
    const k0 = info.vfr ? 0 : run[0]!;
    const seek = k0 > 0 ? ["-ss", ((k0 - 0.5) / info.fps).toFixed(6)] : [];
    const filters = [
      `select=${run.map((k) => `eq(n\\,${k - k0})`).join("+")}`,
      ...(w !== info.width || h !== info.height ? [`scale=${w}:${h}`] : []),
      "format=gray",
    ];
    const raw = runFfmpeg([
      ...seek,
      "-i",
      info.path,
      "-an",
      "-vf",
      filters.join(","),
      "-fps_mode",
      "passthrough",
      "-frames:v",
      String(run.length),
      "-f",
      "rawvideo",
      "-",
    ]);
    const frames: Uint8Array[] = [];
    for (let i = 0; i + size <= raw.length; i += size) frames.push(raw.subarray(i, i + size));
    return frames;
  });
}

/**
 * Each sampled frame's faces as [x, y, w, h] shares of the frame. `minFace` is the smallest face looked for as a
 * share of the frame's height (default FACE_MIN; 0 looks down to the cascades' 20 px, for crowds).
 */
export async function faceBoxes(
  info: VideoInfo,
  start: number,
  end: number,
  samples: number,
  opts: { minFace?: number } = {},
) {
  const cv = await loadOpenCv((m) => console.error(m));
  const ks = sampleFrames(info.fps, start, end, samples);
  const w = Math.min(WORK_W, info.width);
  const h =
    w === info.width
      ? info.height
      : Math.max(2, Math.round((info.height * w) / info.width / 2) * 2);
  const frames = readSamples(info, ks, w, h);
  const min = minWindow(h, opts.minFace ?? FACE_MIN);
  const cascades = ["haarcascade_frontalface_alt2.xml", "haarcascade_profileface.xml"].map(
    (name) => {
      const c = new cv.CascadeClassifier();
      c.load(name);
      return c;
    },
  );
  try {
    return frames.map((px, i) => {
      const gray = greyMat(cv, px, w, h);
      const boxes: number[][] = [];
      try {
        for (const c of cascades) {
          const found = new cv.RectVector();
          c.detectMultiScale(gray, found, STEP, 5, 0, new cv.Size(min, min));
          for (let j = 0; j < found.size(); j++) {
            const r = found.get(j);
            boxes.push([r.x / w, r.y / h, r.width / w, r.height / h]);
          }
          found.delete();
        }
      } finally {
        gray.delete();
      }
      return { frame: ks[i]!, t: round(ks[i]! / info.fps, 3), boxes };
    });
  } finally {
    for (const c of cascades) c.delete();
  }
}

/** The subject's face among a frame's: the largest, or the smallest when the person is cast in a crowd. */
function subjectFace(boxes: number[][], cast = false): number[] | null {
  return boxes.reduce<number[] | null>(
    (a, b) => (!a || (cast ? b[3]! < a[3]! : b[3]! > a[3]!) ? b : a),
    null,
  );
}

/** The subject's face (largest, or the smallest when the person is cast in a crowd), its median and last height. */
export function faceSummary(
  samples: { frame: number; t: number; boxes: number[][] }[],
  cast = false,
) {
  const pick = (boxes: number[][]) => subjectFace(boxes, cast);
  const seen = samples.flatMap((s) => {
    const b = pick(s.boxes);
    return b ? [{ t: s.t, box: b.map((v) => round(v, 4)) }] : [];
  });
  const heights = seen.map((s) => s.box[3]!).sort((a, b) => a - b);
  const height = heights.length ? heights[heights.length >> 1]! : null;
  const lastFace = pick(samples.at(-1)?.boxes ?? []);
  const last = lastFace ? lastFace[3]! : null;
  const verdicts = [faceVerdict(height, cast), faceVerdict(last, cast)];
  return {
    frames_sampled: samples.length,
    frames_with_face: seen.length,
    face_height: height === null ? null : round(height, 3),
    last_face_height: last === null ? null : round(last, 3),
    verdict: verdicts.reduce((a, b) => (ORDER.indexOf(b) < ORDER.indexOf(a) ? b : a)),
    bands: { pass: FACE_HOLDS, cast_fail_below: FACE_SLIDES, fail_below: FACE_FLOOR },
    boxes: seen,
    ...(last === null
      ? {
          note: "no face at the last sampled frame (turned away, covered or missed): look at the frames",
        }
      : {}),
  };
}

const median = (v: number[]) => [...v].sort((x, y) => x - y)[v.length >> 1]!;

/** Fewest moments with a face on both sides that a fit is given from. */
export const FIT_MIN_FACES = 2;
const PAIR_S = 0.1;

/**
 * Where --against starts reading the clip: a render as long as the original runs on film time, so at --from; a
 * shot of its own (a generated clip) starts at its own 0.
 */
export function againstStart(clipDuration: number, originalDuration: number, from: number): number {
  return Math.abs(clipDuration - originalDuration) <= 0.5 ? from : 0;
}

/** The GSAP transform putting a cover-fit clip's face on the original's: `scale` about the clip's centre, then `x`, `y`
 * in canvas pixels. Moments pair by time within PAIR_S and each side's faces are medianed, so one stray detection can't
 * move it. `residual` is the median distance left between the faces, in the original's face heights. */
export function faceFit(
  original: { t: number; boxes: number[][] }[],
  clip: { t: number; boxes: number[][] }[],
  canvas: { width: number; height: number },
  clipSize: { width: number; height: number },
  cast = false,
) {
  const pairs = original.flatMap((o) => {
    const near = clip.reduce<(typeof clip)[number] | null>(
      (p, q) => (!p || Math.abs(q.t - o.t) < Math.abs(p.t - o.t) ? q : p),
      null,
    );
    if (!near || Math.abs(near.t - o.t) > PAIR_S) return [];
    const [a, b] = [subjectFace(o.boxes, cast), subjectFace(near.boxes, cast)];
    return a && b ? [{ a, b }] : [];
  });
  if (pairs.length < FIT_MIN_FACES) return { moments: pairs.length, transform: null };
  const { width: W, height: H } = canvas;
  // object-fit: cover, centred: the clip's pixel (u, v) lands on the canvas at (ox + u s0, oy + v s0).
  const s0 = Math.max(W / clipSize.width, H / clipSize.height);
  const [cw, ch] = [clipSize.width * s0, clipSize.height * s0];
  const [ox, oy] = [(W - cw) / 2, (H - ch) / 2];
  const face = (b: number[], w: number, h: number, x0: number, y0: number) => ({
    x: x0 + (b[0]! + b[2]! / 2) * w,
    y: y0 + (b[1]! + b[3]! / 2) * h,
    h: b[3]! * h,
  });
  const os = pairs.map((p) => face(p.a, W, H, 0, 0));
  const cs = pairs.map((p) => face(p.b, cw, ch, ox, oy));
  const mid = (v: { x: number; y: number; h: number }[]) => ({
    x: median(v.map((f) => f.x)),
    y: median(v.map((f) => f.y)),
    h: median(v.map((f) => f.h)),
  });
  const [o, c] = [mid(os), mid(cs)];
  const scale = o.h / c.h;
  // About the element's centre (GSAP's default transform origin): p -> centre + scale (p - centre) + (x, y).
  const x = o.x - (W / 2 + scale * (c.x - W / 2));
  const y = o.y - (H / 2 + scale * (c.y - H / 2));
  const residual = median(
    pairs.map((_, i) => {
      const [p, q] = [os[i]!, cs[i]!];
      const [mx, my] = [W / 2 + scale * (q.x - W / 2) + x, H / 2 + scale * (q.y - H / 2) + y];
      return Math.hypot(mx - p.x, my - p.y) / p.h;
    }),
  );
  return {
    moments: pairs.length,
    transform: { scale: round(scale, 3), x: round(x, 1), y: round(y, 1) },
    original_face: { centre: [round(o.x, 1), round(o.y, 1)], height: round(o.h, 1) },
    clip_face: { centre: [round(c.x, 1), round(c.y, 1)], height: round(c.h, 1) },
    residual: round(residual, 3),
  };
}
