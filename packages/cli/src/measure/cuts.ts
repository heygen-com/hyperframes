// A cut is a frame far unlike the one before and several times unlike its neighbours' changes: ffmpeg's scene
// score missed real cuts at 0.25.
import { decode, meanAbsDiff, type Frames } from "./media.js";

const SIG_W = 64;
const SIG_H = 36;
const CUT_LEVEL = 12;
const CUT_RATIO = 4;

export function signatures(input: string[], filters: string[] = []): Frames {
  return decode(input, [...filters, `scale=${SIG_W}:${SIG_H}:flags=area`], SIG_W, SIG_H, true);
}

const median = (values: number[]) => {
  const sorted = [...values].sort((x, y) => x - y);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};

/** Where each shot starts; a whip or two-frame dissolve changing on consecutive frames is one cut `frames` long. */
export function findCuts(
  frames: Uint8Array[],
): { frame: number; frames: number; change: number }[] {
  const diffs = frames.map((f, i) => (i ? meanAbsDiff(frames[i - 1]!, f) : 0));
  const hits = diffs.flatMap((d, i) => {
    if (i === 0 || d < CUT_LEVEL) return [];
    const around = diffs.slice(Math.max(1, i - 12), i).concat(diffs.slice(i + 1, i + 13));
    return d >= CUT_RATIO * Math.max(1, median(around)) ? [{ frame: i, change: d }] : [];
  });
  const out: { frame: number; frames: number; change: number }[] = [];
  for (const h of hits) {
    const last = out.at(-1);
    if (last && h.frame === last.frame + last.frames) {
      last.frames++;
      last.change = Math.max(last.change, h.change);
    } else out.push({ ...h, frames: 1 });
  }
  return out;
}
