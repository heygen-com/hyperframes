import { roundToCenti } from "../../utils/rounding";
import { resolveTimelineMinDuration } from "./timelineGroupEditing";

/**
 * Pure math for the four NLE trim operations (ripple / roll / slip / slide).
 *
 * All four are LANE-SCOPED: they read and rewrite only the clips on the grabbed
 * clip's own display lane, matching the existing lane-scoped gap tooling
 * (see timelineGaps.ts). Cross-lane sync-lock is deliberately out of scope.
 *
 * Shape of the module: `resolveTrimPlan` decides WHICH clips an operation
 * touches (returning null when the gesture is impossible — e.g. a roll with no
 * neighbour across the edit point), `resolveTrimDeltaBounds` says how far the
 * gesture may travel, and `applyTrimDelta` produces the per-clip timing patches.
 * Keeping the three separate is what lets the preview clamp live and the commit
 * reuse the very same numbers.
 *
 * Conventions (verified against Final Cut Pro / Premiere Pro semantics):
 * - Ripple: the trimmed clip keeps its START; its duration changes and every
 *   later clip on the lane shifts by the same amount, so the lane never gains a
 *   gap or an overlap and the composition gets longer/shorter by the trim.
 * - Roll: the shared edit point between two adjacent clips moves; one grows by
 *   exactly what the other loses, so nothing downstream moves.
 * - Slip: the clip's source in/out move together; its position and duration on
 *   the lane are untouched, so nothing else moves.
 * - Slide: the clip moves in time; the previous clip's out point and the next
 *   clip's in point absorb the move, so nothing downstream moves.
 */

export type TimelineTrimMode = "ripple" | "roll" | "slip" | "slide";
export type TimelineTrimEdge = "start" | "end";

/** Adjacency tolerance, in seconds — mirrors timelineGaps' epsilon. */
const TRIM_ADJACENCY_EPSILON_S = 1e-3;

/** The minimal timing view of a clip the trim math needs. */
export interface TrimClip {
  key: string;
  start: number;
  duration: number;
  playbackStart?: number;
  playbackRate?: number;
  sourceDuration?: number;
  /**
   * Whether the clip samples a source that can be re-pointed (media, or a
   * sub-composition). False for generated pixels — text, shapes, plain
   * elements: they have no in point, so slipping one is meaningless and
   * writing an in point onto one is noise. The store reports `playbackStart: 0`
   * for every element regardless, which is why this cannot be inferred here.
   */
  sourceWindow?: boolean;
}

export type TrimPlan =
  | { mode: "ripple"; edge: TimelineTrimEdge; grabbed: TrimClip; followers: TrimClip[] }
  | { mode: "roll"; left: TrimClip; right: TrimClip }
  | { mode: "slip"; grabbed: TrimClip }
  | { mode: "slide"; grabbed: TrimClip; prev: TrimClip | null; next: TrimClip | null };

/**
 * One clip's post-trim timing. An absent `playbackStart` means "leave this
 * clip's in point exactly as it is" — the persist then writes no in-point
 * attribute at all, which is what keeps a rippled neighbour indistinguishable
 * from the same clip moved by hand.
 */
export interface TrimChange {
  key: string;
  start: number;
  duration: number;
  playbackStart?: number;
}

export interface TrimDeltaBounds {
  minDelta: number;
  maxDelta: number;
}

const rateOf = (clip: TrimClip): number => Math.max(0.1, clip.playbackRate ?? 1);
const endOf = (clip: TrimClip): number => clip.start + clip.duration;

/**
 * How much LATER the clip's out point may be pushed before it runs out of source
 * media, in timeline seconds. Infinite for clips with no source (text, shapes).
 */
function outPointHeadroom(clip: TrimClip): number {
  if (clip.sourceDuration == null || !Number.isFinite(clip.sourceDuration)) {
    return Number.POSITIVE_INFINITY;
  }
  return (clip.sourceDuration - (clip.playbackStart ?? 0)) / rateOf(clip) - clip.duration;
}

/**
 * How much EARLIER the clip's in point may be pulled before it runs out of
 * source media, in timeline seconds. Infinite for clips with no in point at all
 * (`playbackStart` undefined ⇒ nothing to rewind).
 */
function inPointHeadroom(clip: TrimClip): number {
  return clip.playbackStart != null ? clip.playbackStart / rateOf(clip) : Number.POSITIVE_INFINITY;
}

/** Lane clips sorted by start; key breaks ties so the order is deterministic. */
function sortedLane(lane: readonly TrimClip[]): TrimClip[] {
  return [...lane].sort((a, b) => a.start - b.start || a.key.localeCompare(b.key));
}

/**
 * Resolve which clips a trim gesture touches, or null when the gesture cannot
 * run: a roll with no clip across the edit point, a slip on a clip with no
 * source window, or a grabbed key that is not on the lane.
 */
export function resolveTrimPlan(
  lane: readonly TrimClip[],
  grabbedKey: string,
  mode: TimelineTrimMode,
  edge: TimelineTrimEdge,
  epsilon: number = TRIM_ADJACENCY_EPSILON_S,
): TrimPlan | null {
  const clips = sortedLane(lane);
  const index = clips.findIndex((c) => c.key === grabbedKey);
  if (index < 0) return null;
  const grabbed = clips[index]!;

  if (mode === "ripple") {
    // Everything that starts at or after the grabbed clip's out point rides the
    // trim. A clip that merely overlaps (spill lane) is left alone: shifting it
    // would change an overlap the author chose.
    const followers = clips.filter((c) => c.start >= endOf(grabbed) - epsilon);
    return { mode, edge, grabbed, followers };
  }

  if (mode === "slip") {
    // Slipping moves the source window; generated pixels have no window to move.
    if (!grabbed.sourceWindow) return null;
    return { mode, grabbed };
  }

  const { prev, next } = buttedNeighbours(clips, index, epsilon);

  if (mode === "roll") {
    // The edit point is the grabbed EDGE; rolling needs a clip butted against it.
    const pair = edge === "start" ? { left: prev, right: grabbed } : { left: grabbed, right: next };
    return pair.left && pair.right ? { mode, left: pair.left, right: pair.right } : null;
  }

  // Slide: only ADJACENT neighbours absorb the move. A neighbour separated by a
  // gap is not rewritten — the gap absorbs the slide instead, which is what the
  // author sees and the least surprising thing to do.
  return { mode, grabbed, prev, next };
}

/**
 * The lane neighbours BUTTED against the clip at `index` — null when a gap
 * separates them, because a gap means there is no shared edit point to move.
 */
function buttedNeighbours(
  clips: readonly TrimClip[],
  index: number,
  epsilon: number,
): { prev: TrimClip | null; next: TrimClip | null } {
  const clip = clips[index]!;
  const before = clips[index - 1];
  const after = clips[index + 1];
  return {
    prev: before && Math.abs(endOf(before) - clip.start) <= epsilon ? before : null,
    next: after && Math.abs(after.start - endOf(clip)) <= epsilon ? after : null,
  };
}

/** The delta range the plan can absorb, before rounding. Unbounded ⇒ ±Infinity. */
export function resolveTrimDeltaBounds(
  plan: TrimPlan,
  minDuration: number = resolveTimelineMinDuration(),
  laneFloor = 0,
): TrimDeltaBounds {
  switch (plan.mode) {
    case "ripple": {
      const { grabbed, followers, edge } = plan;
      // Followers ride the trim; none of them may be pushed before the floor.
      const followerSlack = followers.length
        ? Math.min(...followers.map((f) => f.start)) - laneFloor
        : Number.POSITIVE_INFINITY;
      if (edge === "end") {
        return {
          minDelta: Math.max(minDuration - grabbed.duration, -followerSlack),
          maxDelta: outPointHeadroom(grabbed),
        };
      }
      // Start edge: +delta trims the head (shorter clip, lane pulls left).
      return {
        minDelta: -inPointHeadroom(grabbed),
        maxDelta: Math.min(grabbed.duration - minDuration, followerSlack),
      };
    }
    case "roll": {
      const { left, right } = plan;
      return {
        minDelta: Math.max(minDuration - left.duration, -inPointHeadroom(right)),
        maxDelta: Math.min(outPointHeadroom(left), right.duration - minDuration),
      };
    }
    case "slip": {
      // +delta drags the source strip right ⇒ EARLIER material ⇒ in point falls.
      const { grabbed } = plan;
      return { minDelta: -outPointHeadroom(grabbed), maxDelta: inPointHeadroom(grabbed) };
    }
    case "slide": {
      const { grabbed, prev, next } = plan;
      const minDelta = Math.max(
        prev ? minDuration - prev.duration : laneFloor - grabbed.start,
        next ? -inPointHeadroom(next) : Number.NEGATIVE_INFINITY,
      );
      const maxDelta = Math.min(
        prev ? outPointHeadroom(prev) : Number.POSITIVE_INFINITY,
        next ? next.duration - minDuration : Number.POSITIVE_INFINITY,
      );
      return { minDelta, maxDelta };
    }
  }
}

/** Clamp a raw pointer delta into the plan's bounds and round it to centiseconds. */
export function clampTrimDelta(
  plan: TrimPlan,
  rawDelta: number,
  minDuration: number = resolveTimelineMinDuration(),
  laneFloor = 0,
): number {
  const { minDelta, maxDelta } = resolveTrimDeltaBounds(plan, minDuration, laneFloor);
  // An exhausted plan (maxDelta < minDelta, e.g. a clip already below minDuration)
  // must not invert the clamp into a forced move — freeze it instead.
  if (maxDelta < minDelta) return 0;
  return roundToCenti(Math.min(Math.max(rawDelta, minDelta), maxDelta));
}

/**
 * A clip trimmed at its head: the start and duration absorb the delta, and the
 * in point follows it — but only on a clip that HAS an in point. On generated
 * pixels there is no source to re-point, so the change carries no
 * `playbackStart` and the persist leaves the attribute off the element.
 */
function trimmedHead(clip: TrimClip, delta: number): TrimChange {
  return {
    key: clip.key,
    start: roundToCenti(clip.start + delta),
    duration: roundToCenti(clip.duration - delta),
    playbackStart: clip.sourceWindow
      ? roundToCenti(Math.max(0, (clip.playbackStart ?? 0) + delta * rateOf(clip)))
      : undefined,
  };
}

/** A clip trimmed at its out point: its in point is untouched, so it is absent. */
const trimmedTail = (clip: TrimClip, delta: number): TrimChange => ({
  key: clip.key,
  start: roundToCenti(clip.start),
  duration: roundToCenti(clip.duration + delta),
});

/**
 * A clip that only travels. `playbackStart` is deliberately absent, not copied:
 * these clips are being MOVED, and the move path never writes an in point.
 * Emitting the store's default 0 here would stamp `data-playback-start` onto
 * clips a plain drag leaves alone.
 */
const shifted = (clip: TrimClip, delta: number): TrimChange => ({
  key: clip.key,
  start: roundToCenti(clip.start + delta),
  duration: roundToCenti(clip.duration),
});

/**
 * The per-clip timing patches a plan produces at `delta` (already clamped by
 * {@link clampTrimDelta}). Only clips whose timing actually moves are returned.
 */
export function applyTrimDelta(plan: TrimPlan, delta: number): TrimChange[] {
  if (delta === 0) return [];
  switch (plan.mode) {
    case "ripple": {
      const { grabbed, followers, edge } = plan;
      // Head trim keeps the clip's START (that is what makes it a ripple rather
      // than a plain trim: the lane closes behind the edit, it does not gap).
      const trimmed: TrimChange =
        edge === "end"
          ? trimmedTail(grabbed, delta)
          : { ...trimmedHead(grabbed, delta), start: roundToCenti(grabbed.start) };
      const laneShift = edge === "end" ? delta : -delta;
      return [trimmed, ...followers.map((f) => shifted(f, laneShift))];
    }
    case "roll":
      return [trimmedTail(plan.left, delta), trimmedHead(plan.right, delta)];
    case "slip": {
      const { grabbed } = plan;
      return [
        {
          key: grabbed.key,
          start: roundToCenti(grabbed.start),
          duration: roundToCenti(grabbed.duration),
          playbackStart: roundToCenti(
            Math.max(0, (grabbed.playbackStart ?? 0) - delta * rateOf(grabbed)),
          ),
        },
      ];
    }
    case "slide": {
      const { grabbed, prev, next } = plan;
      const changes: TrimChange[] = [shifted(grabbed, delta)];
      if (prev) changes.unshift(trimmedTail(prev, delta));
      if (next) changes.push(trimmedHead(next, delta));
      return changes;
    }
  }
}

/**
 * The lane-space edge the gesture actually moves, so the snap pass has one thing
 * to land on the grid: `edgeTime = time + sign * delta`, and inversely
 * `delta = sign * (snappedEdgeTime - time)`.
 *
 * For a head ripple the grabbed (left) edge does NOT move — the clip's OUT point
 * and everything after it does — so that is what snaps, with an inverted sign.
 * Slip returns null: it moves the source window, not a lane edge, so there is
 * nothing on the timeline grid for it to snap to.
 */
export function trimSnapAnchor(plan: TrimPlan): { time: number; sign: 1 | -1 } | null {
  switch (plan.mode) {
    case "ripple":
      return { time: endOf(plan.grabbed), sign: plan.edge === "end" ? 1 : -1 };
    case "roll":
      return { time: endOf(plan.left), sign: 1 };
    case "slip":
      return null;
    case "slide":
      return { time: plan.grabbed.start, sign: 1 };
  }
}

/** Every clip key a plan may rewrite — the set the snap pass must ignore. */
export function trimPlanKeys(plan: TrimPlan): Set<string> {
  switch (plan.mode) {
    case "ripple":
      return new Set([plan.grabbed.key, ...plan.followers.map((f) => f.key)]);
    case "roll":
      return new Set([plan.left.key, plan.right.key]);
    case "slip":
      return new Set([plan.grabbed.key]);
    case "slide":
      return new Set(
        [plan.grabbed.key, plan.prev?.key, plan.next?.key].filter((k): k is string => k != null),
      );
  }
}
