// One textured thing followed frame by frame (a cursor, a hand, a product), ported from hf-media's track: the box at
// one moment is the template, each next frame is searched near the last match by normalized cross-correlation, and
// the track ends at a cut, a weak match or an ambiguous one rather than guessing. Moves come out as eases.
import { findCuts } from "./cuts.js";
import { fitMoves, printable, type Row } from "./curve.js";
import { readClip, round, videoClip, type Roi, type VideoInfo } from "./media.js";
import { greyMat, loadOpenCv } from "./opencv.js";

const WORK_W = 960;

export interface TrackOptions {
  info: VideoInfo;
  /** The moment the template is cut from, and the box it is cut from (source pixels). */
  at: number;
  box: Roi;
  to: number;
  /** How far it may move between two frames, in source pixels. */
  radius?: number;
  minScore?: number;
  /** How far the best match must beat the runner-up elsewhere. */
  minMargin?: number;
}

export interface Tracked {
  rows: Row[];
  scores: number[];
  lost: { t: number; reason: "cut" | "low_score" | "ambiguous"; score?: number } | null;
  moves: ReturnType<typeof printable>;
  /** Working size the search ran at, for drawing. */
  scale: number;
}

// fallow-ignore-next-line complexity
export async function trackTemplate(o: TrackOptions): Promise<Tracked> {
  const cv = await loadOpenCv((m) => console.error(m));
  const k = Math.min(1, WORK_W / o.info.width);
  const { frames, w, h } = readClip(videoClip(o.info.path, o.at, o.to - o.at, o.info), {
    width: Math.round(o.info.width * k),
    gray: true,
  });
  const cuts = new Set(findCuts(frames).map((c) => c.frame));
  const [bx, by, bw, bh] = o.box.map((v) => Math.round(v * k));
  const tw = Math.max(4, Math.min(bw!, w - bx!));
  const th = Math.max(4, Math.min(bh!, h - by!));
  const templ = new Uint8Array(tw * th);
  for (let y = 0; y < th; y++)
    templ.set(frames[0]!.subarray((by! + y) * w + bx!, (by! + y) * w + bx! + tw), y * tw);
  const tMat = greyMat(cv, templ, tw, th);
  const radius = Math.max(2, Math.round((o.radius ?? 48) * k));
  const fps = o.info.fps;
  const centre = (x: number, y: number): Row => ({
    t: 0,
    x: (x + tw / 2) / k,
    y: (y + th / 2) / k,
    w: tw / k,
    h: th / k,
    ink: 1,
  });
  const rows: Row[] = [{ ...centre(bx!, by!), t: round(o.at, 3) }];
  const scores = [1];
  let [px, py] = [bx!, by!];
  let lost: Tracked["lost"] = null;
  try {
    for (let i = 1; i < frames.length; i++) {
      const t = round(o.at + i / fps, 3);
      if (cuts.has(i)) {
        lost = { t, reason: "cut" };
        break;
      }
      const [x0, y0] = [Math.max(0, px - radius), Math.max(0, py - radius)];
      const [x1, y1] = [Math.min(w, px + tw + radius), Math.min(h, py + th + radius)];
      const sw = x1 - x0;
      const sh = y1 - y0;
      const area = new Uint8Array(sw * sh);
      for (let y = 0; y < sh; y++)
        area.set(frames[i]!.subarray((y0 + y) * w + x0, (y0 + y) * w + x1), y * sw);
      const aMat = greyMat(cv, area, sw, sh);
      const result = new cv.Mat();
      try {
        cv.matchTemplate(aMat, tMat, result, cv.TM_CCOEFF_NORMED);
        const { maxVal, maxLoc } = cv.minMaxLoc(result);
        // The runner-up away from the best match's own correlation lobe: a second cursor, a repeated icon.
        let second = -Infinity;
        const [rw, dx, dy] = [result.cols, Math.max(1, tw >> 1), Math.max(1, th >> 1)];
        result.data32F.forEach((v, j) => {
          const [cx, cy] = [j % rw, Math.floor(j / rw)];
          if ((Math.abs(cx - maxLoc.x) > dx || Math.abs(cy - maxLoc.y) > dy) && v > second)
            second = v;
        });
        const margin = Number.isFinite(second) ? maxVal - second : 1;
        if (maxVal < (o.minScore ?? 0.6) || margin < (o.minMargin ?? 0.05)) {
          lost = {
            t,
            reason: maxVal < (o.minScore ?? 0.6) ? "low_score" : "ambiguous",
            score: round(maxVal, 3),
          };
          break;
        }
        [px, py] = [x0 + maxLoc.x, y0 + maxLoc.y];
        rows.push({ ...centre(px, py), t });
        scores.push(maxVal);
      } finally {
        aMat.delete();
        result.delete();
      }
    }
  } finally {
    tMat.delete();
  }
  const quant = 1 / k;
  const moves = (["x", "y"] as const)
    .flatMap((p) =>
      fitMoves(
        rows,
        p,
        fps,
        Math.max(3 * quant, 0.01 * Math.max(o.info.width, o.info.height)),
        quant,
      ),
    )
    .sort((a, b) => a.start_s - b.start_s);
  return { rows, scores, lost, moves: printable(moves), scale: k };
}
