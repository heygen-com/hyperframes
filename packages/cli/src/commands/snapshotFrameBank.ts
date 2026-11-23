export interface FrameWant {
  time: number;
  displayedPixels: number;
  holdLastFrame: boolean;
}

export interface SeekPlan {
  seek?: number;
  select?: number;
  /** Where ffmpeg really starts decoding: the keyframe at or before `seek`. */
  decodesFrom?: number;
}

/** A frame with its decode known: runs from `decodesFrom`, `-ss seek` drops the rest, `seek + select` is the cut. */
export interface PlannedFrame extends FrameWant {
  seek: number;
  select: number;
  decodesFrom: number;
}

interface FrameBankDeps {
  probe: (
    path: string,
    time: number,
    holdLastFrame: boolean,
    horizon: number,
  ) => Promise<SeekPlan | null>;
  /** One ffmpeg pass over `frames`, which share a displayed size; throws when the pass fails. */
  decode: (path: string, frames: PlannedFrame[]) => Promise<Buffer[]>;
}

const slotKey = (path: string, want: FrameWant) =>
  `${path}\0${want.time.toFixed(6)}\0${want.displayedPixels}\0${want.holdLastFrame}`;

/** Frames whose decode runs overlap share one pass: a one-keyframe source decodes once, not once per frame. */
export function groupOverlappingDecodes(frames: PlannedFrame[]): PlannedFrame[][] {
  const sorted = [...frames].sort((a, b) => a.decodesFrom - b.decodesFrom);
  const groups: PlannedFrame[][] = [];
  let end = Number.NEGATIVE_INFINITY;
  for (const frame of sorted) {
    if (frame.decodesFrom > end) groups.push([]);
    groups[groups.length - 1]!.push(frame);
    end = Math.max(end, frame.seek + frame.select);
  }
  return groups;
}

type Probe = FrameBankDeps["probe"];

/** Each distinct frame once, with how many requests ask for it. */
function countAsked(
  path: string,
  wants: FrameWant[],
): Map<string, { want: FrameWant; uses: number }> {
  const asked = new Map<string, { want: FrameWant; uses: number }>();
  for (const want of wants) {
    const key = slotKey(path, want);
    asked.set(key, { want, uses: (asked.get(key)?.uses ?? 0) + 1 });
  }
  return asked;
}

/** The wanted frames whose decode is known; a failed probe leaves its frames to the single-frame path. */
async function probeFrames(
  probe: Probe,
  path: string,
  wants: FrameWant[],
): Promise<PlannedFrame[]> {
  try {
    const horizon = Math.max(...wants.map((want) => want.time));
    const plans = await Promise.all(
      wants.map((want) => probe(path, want.time, want.holdLastFrame, horizon)),
    );
    return plans.flatMap((plan, i) =>
      plan?.seek !== undefined && plan.select !== undefined
        ? [
            {
              ...wants[i]!,
              seek: plan.seek,
              select: plan.select,
              decodesFrom: plan.decodesFrom ?? plan.seek,
            },
          ]
        : [],
    );
  } catch {
    return [];
  }
}

/** One pass decodes one displayed size, so frames split by size before they split by overlap. */
function passGroups(planned: PlannedFrame[]): PlannedFrame[][] {
  const sizes = [...new Set(planned.map((frame) => frame.displayedPixels))];
  return sizes.flatMap((size) =>
    groupOverlappingDecodes(planned.filter((frame) => frame.displayedPixels === size)),
  );
}

interface BankStats {
  passes: number;
  frames: number;
  sharedFrames: number;
  longestDecodeSeconds: number;
}

function countPass(stats: BankStats, group: PlannedFrame[]): void {
  stats.passes += 1;
  stats.frames += group.length;
  if (group.length > 1) stats.sharedFrames += group.length;
  for (const frame of group)
    stats.longestDecodeSeconds = Math.max(
      stats.longestDecodeSeconds,
      frame.seek + frame.select - frame.decodesFrom,
    );
}

/** Plans every frame a video will be asked for, decodes them group by group, and hands each one to its request.
 * A pass that fails hands back nothing, so its frames decode one at a time as they always did. */
export function createFrameBank(deps: FrameBankDeps) {
  const slots = new Map<string, { frame: () => Promise<Buffer | undefined>; uses: number }>();
  const stats: BankStats = { passes: 0, frames: 0, sharedFrames: 0, longestDecodeSeconds: 0 };
  return {
    stats,
    async plan(path: string, wants: FrameWant[]): Promise<void> {
      const asked = countAsked(path, wants);
      const fresh = [...asked].filter(([key]) => !slots.has(key)).map(([, { want }]) => want);
      for (const group of passGroups(await probeFrames(deps.probe, path, fresh))) {
        countPass(stats, group);
        // A pass starts when its first frame is asked for, so the caller's own limit on concurrent work holds.
        let run: Promise<Buffer[] | undefined> | undefined;
        const start = () => (run ??= deps.decode(path, group).catch(() => undefined));
        for (const [i, frame] of group.entries()) {
          const key = slotKey(path, frame);
          slots.set(key, {
            frame: () => start().then((buffers) => buffers?.[i]),
            uses: asked.get(key)?.uses ?? 1,
          });
        }
      }
    },
    /** The planned frame's bytes; undefined, now or once its pass failed, means decode it alone. */
    take(path: string, want: FrameWant): Promise<Buffer | undefined> | undefined {
      const key = slotKey(path, want);
      const slot = slots.get(key);
      if (slot && --slot.uses <= 0) slots.delete(key);
      return slot?.frame();
    },
  };
}
