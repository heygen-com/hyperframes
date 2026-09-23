/**
 * Hands segments to parallel capture workers (spec §5 Phase 2 items 1-2).
 *
 * Workers pull in index order but finish out of order, which is fine: the
 * concat list is built from the plan, not from completion order, so ordering
 * never reaches the encoders.
 */
import type { SegmentSlice } from "./segmentPlan.js";

export interface SegmentQueue {
  /** The next unclaimed slice, or undefined when the queue is drained. */
  next(): SegmentSlice | undefined;
  remaining(): number;
}

export function createSegmentQueue(slices: readonly SegmentSlice[]): SegmentQueue {
  let cursor = 0;
  return {
    next: () => slices[cursor++],
    remaining: () => Math.max(0, slices.length - cursor),
  };
}
