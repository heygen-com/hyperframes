export const instantTolerance = (time: number) => 4 * Number.EPSILON * Math.max(1, Math.abs(time));

/** Float sums like 19.8 + 6.4 miss 26.2 by a rounding step; a few steps, scaled to the time, are one instant. */
export function sameInstant(a: number, b: number): boolean {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return a === b;
  return Math.abs(a - b) <= instantTolerance(Math.max(Math.abs(a), Math.abs(b)));
}

const isBefore = (a: number, b: number) => a < b && !sameInstant(a, b);

/** For timeline lanes: a zero-length clip inside another still counts, so it gets a lane of its own. */
export function spansOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return isBefore(aStart, bEnd) && isBefore(bStart, aEnd);
}

export function spansShareTime(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): boolean {
  return isBefore(Math.max(aStart, bStart), Math.min(aEnd, bEnd));
}

export const isInsideSpan = (time: number, start: number, end: number) =>
  isBefore(start, time) && isBefore(time, end);
