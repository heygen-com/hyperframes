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
const HELD_CHANGE = 0.5;
const MIN_MOVING_BURSTS = 4;
const HELD_SHARE = 0.6;
const HELD_RATIO = 3;
const MAX_CUT_FRAMES = 3;
const FLASH_FRAMES = 4;
const RETURNED = 0.4;
const SAME_TONES = 0.8;

export interface Cut {
  frame: number;
  /** A whip or a two-frame dissolve changes on consecutive frames: one cut this many frames long. */
  frames: number;
  /** Its largest change, in mean grey levels. */
  change: number;
  soft?: true;
  /** Not a new shot: a light flash (the picture comes back) or a whip, a fast move or a dissolve. Absent for a cut. */
  kind?: "flash" | "fast";
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

const neighbours = (diffs: number[], i: number, end = i + 1) =>
  diffs.slice(Math.max(1, i - NEIGHBOURS), i).concat(diffs.slice(end, end + NEIGHBOURS));

const moving = (around: number[]) => around.filter((d) => d >= HELD_CHANGE);

/** Animation on twos: the picture moves and holds in turn, so the median reads as no motion at all. */
const isHeld = (around: number[]) => {
  const bursts = around.filter((d, i) => d >= HELD_CHANGE && (around[i - 1] ?? 0) < HELD_CHANGE);
  return bursts.length >= MIN_MOVING_BURSTS && moving(around).length <= HELD_SHARE * around.length;
};

const typicalOf = (around: number[]) =>
  Math.max(1, median(isHeld(around) ? moving(around) : around));

export function cutsIn(diffs: number[]): Cut[] {
  const hits = diffs.flatMap((d, i): { frame: number; change: number; soft?: true }[] => {
    if (i === 0) return [];
    const around = neighbours(diffs, i);
    const ratio = isHeld(around) ? HELD_RATIO : CUT_RATIO;
    if (d >= CUT_LEVEL && d >= ratio * typicalOf(around)) return [{ frame: i, change: d }];
    const alone = d >= SOFT_ALONE * Math.max(0, ...around);
    return d >= SOFT_LEVEL && d >= SOFT_RATIO * Math.max(1, median(around)) && alone
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

const tones = (frame: Uint8Array) => {
  const bins = new Array<number>(16).fill(0);
  for (const level of frame) bins[level >> 4]!++;
  return bins.map((n) => n / frame.length);
};

/** The share of pixels two pictures have in common by tone, wherever they sit in the frame. */
const sharedTones = (a: Uint8Array, b: Uint8Array) => {
  const after = tones(b);
  return tones(a).reduce((sum, share, bin) => sum + Math.min(share, after[bin]!), 0);
};

/** Every change that reads as a cut, each marked a flash or a fast move when it is not a new shot. */
export function classifiedCuts(frames: Uint8Array[]): Cut[] {
  const diffs = frameChanges(frames);
  return cutsIn(diffs).map((c) => {
    const end = c.frame + c.frames;
    const back = (a: number, b: number) =>
      frames[a] && frames[b] ? meanAbsDiff(frames[a]!, frames[b]!) < RETURNED * c.change : false;
    if (c.frames > MAX_CUT_FRAMES) {
      const before = frames[c.frame - 1]!;
      const whipKeepsTones = frames
        .slice(c.frame, end + 1)
        .every((f) => sharedTones(before, f) >= SAME_TONES);
      const sameShot = isHeld(neighbours(diffs, c.frame, end)) || whipKeepsTones;
      return sameShot ? { ...c, kind: "fast" as const } : c;
    }
    const returns = Array.from({ length: FLASH_FRAMES }, (_, k) => k + 1).some(
      (k) => back(c.frame - 1, end - 1 + k) || back(c.frame - k, end),
    );
    return returns ? { ...c, kind: "flash" as const } : c;
  });
}

/** The frame indexes where a new shot starts, each with its change and length. */
export function findCuts(frames: Uint8Array[]): Cut[] {
  return classifiedCuts(frames).filter((c) => !c.kind);
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
      d >= CUT_RATIO * typicalOf(neighbours(diffs, i))
    );
  });
}
