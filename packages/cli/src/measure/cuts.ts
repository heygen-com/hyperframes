// Cuts from the frame-to-frame difference, ported from the Studio's videoShots.mjs; ffmpeg's scene score misses some.
// A punch-in at the same angle changes less than a cut, so a smaller change that stands alone is a soft cut.
import { decode, meanAbsDiff, type Frames } from "./media.js";

export const SIG_W = 64;
export const SIG_H = 36;
const CUT_LEVEL = 12;
const CUT_RATIO = 4;
const SOFT_LEVEL = 10;
const SOFT_RATIO = 8;
const SOFT_ALONE = 4;
const CONFIRM_LEVEL = 6;
const CONFIRM_SHARE = 0.5;
const NEIGHBOURS = 12;

export interface Cut {
  frame: number;
  /** A whip or a two-frame dissolve changes on consecutive frames: one cut this many frames long. */
  frames: number;
  /** Its largest change, in mean grey levels. */
  change: number;
  soft?: true;
}

/** Every frame of ffmpeg's `input` (after `filters`) as SIG_W x SIG_H grey levels. */
export function signatures(input: string[], filters: string[] = []): Frames {
  return decode(input, [...filters, `scale=${SIG_W}:${SIG_H}:flags=area`], SIG_W, SIG_H, true);
}

const median = (values: number[]) => {
  const sorted = [...values].sort((x, y) => x - y);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};

export function frameChanges(frames: Uint8Array[]): number[] {
  return frames.map((f, i) => (i ? meanAbsDiff(frames[i - 1]!, f) : 0));
}

const neighbours = (diffs: number[], i: number) =>
  diffs.slice(Math.max(1, i - NEIGHBOURS), i).concat(diffs.slice(i + 1, i + NEIGHBOURS + 1));

export function cutsIn(diffs: number[]): Cut[] {
  const hits = diffs.flatMap((d, i): { frame: number; change: number; soft?: true }[] => {
    if (i === 0) return [];
    const around = neighbours(diffs, i);
    const typical = Math.max(1, median(around));
    if (d >= CUT_LEVEL && d >= CUT_RATIO * typical) return [{ frame: i, change: d }];
    const alone = d >= SOFT_ALONE * Math.max(0, ...around);
    return d >= SOFT_LEVEL && d >= SOFT_RATIO * typical && alone
      ? [{ frame: i, change: d, soft: true }]
      : [];
  });
  const out: Cut[] = [];
  for (const { soft, ...h } of hits) {
    const last = out.at(-1);
    if (last && h.frame === last.frame + last.frames) {
      last.frames++;
      last.change = Math.max(last.change, h.change);
      if (!soft) delete last.soft;
    } else out.push({ ...h, frames: 1, ...(soft ? { soft } : {}) });
  }
  return out;
}

/** The frame indexes where a new shot starts, each with its change and length. */
export function findCuts(frames: Uint8Array[]): Cut[] {
  return cutsIn(frameChanges(frames));
}

/**
 * Whether these changes show a clear change within a frame of `frame`, though maybe under a cut's thresholds: a
 * soft cut found on the other side counts as matched by it, as a soft cut is a change near the line.
 */
export function confirmsCut(diffs: number[], cut: Cut): boolean {
  return [cut.frame - 1, cut.frame, cut.frame + 1].some((i) => {
    const d = diffs[i];
    if (i < 1 || d === undefined) return false;
    return (
      d >= Math.max(CONFIRM_LEVEL, CONFIRM_SHARE * cut.change) &&
      d >= CUT_RATIO * Math.max(1, median(neighbours(diffs, i)))
    );
  });
}
