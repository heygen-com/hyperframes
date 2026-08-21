import type { TimelineElement } from "../store/playerStore";

export type TimelineSnapType = "beat" | "playhead" | "clip-edge";

export interface TimelineSnapTarget {
  time: number;
  type: TimelineSnapType;
}

/** Pixel radius within which a time snaps to a target (matches historical beat snap). */
export const TIMELINE_SNAP_PX = 8;

const TYPE_PRIORITY: Record<TimelineSnapType, number> = {
  playhead: 0,
  "clip-edge": 1,
  beat: 2,
};

export function collectTimelineSnapTargets(input: {
  elements: ReadonlyArray<Pick<TimelineElement, "start" | "duration" | "key" | "id">>;
  playheadTime: number | null;
  beatTimes: readonly number[];
  excludeElementKey?: string | null;
}): TimelineSnapTarget[] {
  const byTime = new Map<number, TimelineSnapTarget>();
  const add = (time: number, type: TimelineSnapType) => {
    if (!Number.isFinite(time) || time < 0) return;
    const rounded = Math.round(time * 1000) / 1000;
    const existing = byTime.get(rounded);
    if (!existing || TYPE_PRIORITY[type] < TYPE_PRIORITY[existing.type]) {
      byTime.set(rounded, { time: rounded, type });
    }
  };

  for (const beat of input.beatTimes) add(beat, "beat");
  for (const el of input.elements) {
    if (input.excludeElementKey != null && (el.key ?? el.id) === input.excludeElementKey) continue;
    add(el.start, "clip-edge");
    add(el.start + el.duration, "clip-edge");
  }
  if (input.playheadTime != null) add(input.playheadTime, "playhead");

  return Array.from(byTime.values()).sort((a, b) => a.time - b.time);
}

export function snapTimelineTime(
  time: number,
  targets: readonly TimelineSnapTarget[],
  thresholdSecs: number,
): { time: number; target: TimelineSnapTarget | null } {
  let best: TimelineSnapTarget | null = null;
  let bestDist = thresholdSecs;
  for (const target of targets) {
    const d = Math.abs(target.time - time);
    if (
      d < bestDist ||
      (d === bestDist && best && TYPE_PRIORITY[target.type] < TYPE_PRIORITY[best.type])
    ) {
      bestDist = d;
      best = target;
    }
  }
  return best ? { time: best.time, target: best } : { time, target: null };
}

/**
 * Snap a moved clip so whichever edge (start or end) is nearest a target lands
 * on it, keeping duration fixed. Mirrors the historical beat-snap semantics:
 * clamp to [0, timelineDuration - duration]; if clamping pulls the clip off the
 * target, drop the highlight.
 */
export function snapMoveToTargets(
  start: number,
  duration: number,
  targets: readonly TimelineSnapTarget[],
  pixelsPerSecond: number,
  timelineDuration: number,
): { start: number; snapTime: number | null; snapType: TimelineSnapType | null } {
  if (targets.length === 0) return { start, snapTime: null, snapType: null };
  const thresholdSecs = TIMELINE_SNAP_PX / Math.max(pixelsPerSecond, 1);
  const startSnap = snapTimelineTime(start, targets, thresholdSecs);
  const endSnap = snapTimelineTime(start + duration, targets, thresholdSecs);
  const startMoved = startSnap.target !== null;
  const endMoved = endSnap.target !== null;

  let candidate = start;
  let target: TimelineSnapTarget | null = null;
  if (
    startMoved &&
    (!endMoved || Math.abs(startSnap.time - start) <= Math.abs(endSnap.time - (start + duration)))
  ) {
    candidate = startSnap.time;
    target = startSnap.target;
  } else if (endMoved) {
    candidate = endSnap.time - duration;
    target = endSnap.target;
  }

  const maxStart = Math.max(0, timelineDuration - duration);
  // Round the candidate to ms FIRST, then compare the clamp against that rounded
  // value — not the raw candidate. A frame-quantized duration (e.g. 1/30s, 10/3s)
  // leaves sub-ms residue after rounding that exceeds a 1e-6 tolerance, so comparing
  // the clamp to the raw candidate dropped the snap-line indicator on every snap
  // even though no clamping happened. Comparing against the rounded candidate makes
  // the residue exactly 0 unless the timeline-bounds clamp actually moved the clip.
  const roundedCandidate = Math.round(candidate * 1000) / 1000;
  const clamped = Math.max(0, Math.min(maxStart, roundedCandidate));
  if (target && Math.abs(clamped - roundedCandidate) > 1e-6) target = null;
  return { start: clamped, snapTime: target?.time ?? null, snapType: target?.type ?? null };
}
