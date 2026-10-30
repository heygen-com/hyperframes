// How big the face is and where, ported from hf-media's face_size: OpenCV's frontal and profile Haar cascades on
// evenly spaced frames, graded by face height over frame height. A regenerated presenter keeps the likeness from
// FACE_HOLDS up; below FACE_FLOOR a video model cannot carry one at all (the harness's face-size eval, 2026-10-08).
import { frameAt, readClip, round, videoClip, type VideoInfo } from "./media.js";
import { greyMat, loadOpenCv } from "./opencv.js";

const FACE_HOLDS = 0.25;
const FACE_SLIDES = 0.15;
const FACE_FLOOR = 0.06;
const WORK_W = 960;

type Verdict = "pass" | "warn" | "fail" | "unmeasured";
const ORDER: Verdict[] = ["fail", "unmeasured", "warn", "pass"];

export function faceVerdict(height: number | null, cast = false): Verdict {
  if (height === null) return "unmeasured";
  if (height >= FACE_HOLDS) return "pass";
  return height < (cast ? FACE_SLIDES : FACE_FLOOR) ? "fail" : "warn";
}

/** Each sampled frame's faces as [x, y, w, h] shares of the frame. */
export async function faceBoxes(info: VideoInfo, start: number, end: number, samples: number) {
  const cv = await loadOpenCv((m) => console.error(m));
  const [k0, k1] = [
    frameAt(start, info.fps),
    // The file can run longer than its picture (a longer soundtrack): a frame past the last is never decoded.
    Math.max(
      frameAt(start, info.fps),
      Math.min(info.frames - 1, Math.ceil(end * info.fps - 1e-6) - 1),
    ),
  ];
  const n = Math.min(samples, k1 - k0 + 1);
  const ks = [
    ...new Set(
      Array.from({ length: n }, (_, i) => k0 + Math.round((i * (k1 - k0)) / Math.max(1, n - 1))),
    ),
  ];
  const clip = {
    ...videoClip(info.path, 0, undefined, info),
    filters: [`select=${ks.map((k) => `eq(n\\,${k})`).join("+")}`, `setpts=N/(${info.fpsText})/TB`],
  };
  const { frames, w, h } = readClip(clip, { width: Math.min(WORK_W, info.width), gray: true });
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
          c.detectMultiScale(gray, found, 1.1, 5, 0, new cv.Size(20, 20));
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

/** The subject's face (largest, or the smallest when the person is cast in a crowd), its median and last height. */
export function faceSummary(
  samples: { frame: number; t: number; boxes: number[][] }[],
  cast = false,
) {
  const pick = (boxes: number[][]) =>
    boxes.reduce<number[] | null>(
      (a, b) => (!a || (cast ? b[3]! < a[3]! : b[3]! > a[3]!) ? b : a),
      null,
    );
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
