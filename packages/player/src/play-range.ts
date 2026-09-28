// Range playback: the `range-start` / `range-end` attributes, in film seconds.

import { playRangeHoldTime } from "@hyperframes/core/runtime/protocol";

export interface PlayRange {
  start: number;
  end: number | null;
}

/** The range the player applies for the attributes, and whether it differs from the one asked for:
 *  an end past the film is cut to the film's end, and an empty or negative range applies no range. */
export function resolvePlayRange(
  start: number | null,
  end: number | null,
  duration: number,
): { range: PlayRange | null; clamped: boolean } {
  if (start === null && end === null) return { range: null, clamped: false };
  const from = start ?? 0;
  const cut = end !== null && duration > 0 && end > duration;
  const to = cut ? duration : end;
  const limit = to ?? (duration > 0 ? duration : Infinity);
  if (!(from >= 0) || !(limit > from)) return { range: null, clamped: true };
  return { range: { start: from, end: to }, clamped: cut };
}

export function playRangeStopTime(range: PlayRange, duration: number, fps: number): number {
  const end = range.end ?? duration;
  return end < duration ? playRangeHoldTime(range.start, end, fps) : end;
}

export function isOutsidePlayRange(
  time: number,
  range: PlayRange,
  duration: number,
  fps: number,
): boolean {
  return time < range.start || time >= playRangeStopTime(range, duration, fps);
}
