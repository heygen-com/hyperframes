import { roundToCenti } from "../../utils/rounding";

const DEFAULT_TIMELINE_MIN_DURATION = 0.1;
const ABSOLUTE_TIMELINE_MIN_DURATION = 0.05;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function roundTimelineTime(value: number): number {
  return roundToCenti(value);
}

export function resolveTimelineMinDuration(minDuration?: number): number {
  return Math.max(ABSOLUTE_TIMELINE_MIN_DURATION, minDuration ?? DEFAULT_TIMELINE_MIN_DURATION);
}

/** Playback rate never drops to zero (would make media-in-point math divide by ~0). */
function resolveTimelinePlaybackRate(rate?: number): number {
  return Math.max(0.1, rate ?? 1);
}

interface TimelineStartTrimClip {
  start: number;
  duration: number;
  playbackStart?: number;
  playbackRate?: number;
}

/**
 * Delta bounds for trimming a clip's START edge (shared by single-clip and group
 * resize). Left-bounded by how far the start can move toward `minStart` and by the
 * media in-point (`playbackStart / playbackRate`); right-bounded by `minDuration`.
 * Returned deltas are unrounded — callers round with their own centisecond helper.
 */
export function clipStartTrimDeltaBounds(
  clip: TimelineStartTrimClip,
  minStart: number,
  minDuration: number,
): { minDelta: number; maxDelta: number } {
  const playbackRate = resolveTimelinePlaybackRate(clip.playbackRate);
  const maxLeftExtensionFromMedia =
    clip.playbackStart != null ? clip.playbackStart / playbackRate : Number.POSITIVE_INFINITY;
  return {
    minDelta: -Math.min(clip.start - minStart, maxLeftExtensionFromMedia),
    maxDelta: clip.duration - minDuration,
  };
}

/**
 * Apply a start-edge delta to one clip (unrounded): moves the start, shrinks the
 * duration by the same amount, and shifts the media in-point by the delta scaled to
 * the playback rate (clamped at 0).
 */
export function applyClipStartTrimDelta(
  clip: TimelineStartTrimClip,
  delta: number,
): { start: number; duration: number; playbackStart?: number } {
  const playbackRate = resolveTimelinePlaybackRate(clip.playbackRate);
  return {
    start: clip.start + delta,
    duration: clip.duration - delta,
    playbackStart:
      clip.playbackStart != null
        ? Math.max(0, clip.playbackStart + delta * playbackRate)
        : undefined,
  };
}

export interface TimelineGroupTimingMember {
  start: number;
  duration: number;
  playbackStart?: number;
  playbackRate?: number;
}

export type TimelineGroupResizeEdge = "start" | "end";

export interface TimelineGroupMoveResult {
  delta: number;
  members: Array<Pick<TimelineGroupTimingMember, "start" | "duration">>;
}

export interface TimelineGroupResizeResult {
  delta: number;
  members: Array<Pick<TimelineGroupTimingMember, "start" | "duration" | "playbackStart">>;
}

function clampTimelineGroupMoveDelta(
  rawDelta: number,
  members: readonly TimelineGroupTimingMember[],
): number {
  if (members.length === 0) return 0;
  const minDelta = Math.max(...members.map((member) => -member.start));
  return roundTimelineTime(Math.max(rawDelta, minDelta));
}

export function resolveTimelineGroupMove(
  members: readonly TimelineGroupTimingMember[],
  rawDelta: number,
): TimelineGroupMoveResult {
  const delta = clampTimelineGroupMoveDelta(rawDelta, members);
  return {
    delta,
    members: members.map((member) => ({
      start: roundTimelineTime(member.start + delta),
      duration: member.duration,
    })),
  };
}

export function clampTimelineGroupResizeDelta(
  rawDelta: number,
  members: readonly TimelineGroupTimingMember[],
  edge: TimelineGroupResizeEdge,
  minDuration = resolveTimelineMinDuration(),
): number {
  if (members.length === 0) return 0;

  if (edge === "end") {
    const minDelta = Math.max(...members.map((member) => minDuration - member.duration));
    return roundTimelineTime(Math.max(rawDelta, minDelta));
  }

  // Rigid group: the applied delta is bounded by the most-constrained member.
  const bounds = members.map((member) => clipStartTrimDeltaBounds(member, 0, minDuration));
  const minDelta = Math.max(...bounds.map((b) => b.minDelta));
  const maxDelta = Math.min(...bounds.map((b) => b.maxDelta));
  return roundTimelineTime(clamp(rawDelta, minDelta, maxDelta));
}

export function resolveTimelineGroupResize(
  members: readonly TimelineGroupTimingMember[],
  edge: TimelineGroupResizeEdge,
  rawDelta: number,
  minDuration = resolveTimelineMinDuration(),
): TimelineGroupResizeResult {
  const delta = clampTimelineGroupResizeDelta(rawDelta, members, edge, minDuration);
  return {
    delta,
    members: members.map((member) => {
      if (edge === "end") {
        return {
          start: member.start,
          duration: roundTimelineTime(member.duration + delta),
          playbackStart: member.playbackStart,
        };
      }

      const trimmed = applyClipStartTrimDelta(member, delta);
      return {
        start: roundTimelineTime(trimmed.start),
        duration: roundTimelineTime(trimmed.duration),
        playbackStart:
          trimmed.playbackStart != null ? roundTimelineTime(trimmed.playbackStart) : undefined,
      };
    }),
  };
}
