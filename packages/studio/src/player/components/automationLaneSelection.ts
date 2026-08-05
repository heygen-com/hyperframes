/**
 * Range operations over one automation lane.
 *
 * `replaceRange` is the only mutator every range feature (delete, shapes,
 * paste, stretch) composes, and it carries the invariant that makes them safe:
 * the envelope OUTSIDE the selection never moves. It samples the lane at both
 * edges first and pins anchor points there, so cutting the middle out of a
 * ramp cannot reshape the rest of the clip.
 *
 * Exact for linear segments. A curved segment straddling an edge keeps its
 * edge VALUE but reshapes slightly between its own start and the anchor — the
 * curve exponent now runs over a shorter span. Accepted: the alternative is
 * splitting curves analytically for a difference the ear cannot place.
 */

import {
  MAX_AUTOMATION_POINTS,
  sampleAutomationLane,
  type AutomationRange,
  type HfAutomationLane,
  type HfAutomationPoint,
} from "@hyperframes/core/audio-automation";
import { POINT_MERGE_SEC } from "./automationLaneGeometry";

/** Points inside [t0, t1], endpoints inclusive. */
export function pointsIn(lane: HfAutomationLane, t0: number, t1: number): HfAutomationPoint[] {
  return lane.points.filter((p) => p.t >= t0 && p.t <= t1);
}

/** An anchor, unless `inner` already provides the edge within the merge radius. */
function anchor(
  lane: HfAutomationLane,
  range: AutomationRange,
  t: number,
  inner: readonly HfAutomationPoint[],
): HfAutomationPoint[] {
  if (inner.some((p) => Math.abs(p.t - t) <= POINT_MERGE_SEC)) return [];
  return [{ t, v: sampleAutomationLane(lane, t, range.scale) }];
}

/** Evenly subsample items to a budget, preserving first and last. */
function decimateEvenly<T>(items: readonly T[], budget: number): T[] {
  if (budget <= 0) return [];
  if (items.length <= budget) return [...items];
  if (budget === 1) return [items[0]!];
  const out: T[] = [];
  const step = (items.length - 1) / (budget - 1);
  for (let i = 0; i < budget; i += 1) {
    const item = items[Math.round(i * step)];
    if (item) out.push(item);
  }
  return out;
}

export function replaceRange(input: {
  lane: HfAutomationLane;
  range: AutomationRange;
  t0: number;
  t1: number;
  inner: HfAutomationPoint[];
}): HfAutomationPoint[] {
  const { lane, range, t0, t1, inner } = input;
  // An empty lane draws a flat default; there is nothing to preserve, and
  // pinning anchors would turn "no automation" into a constant lane.
  if (lane.points.length === 0 && inner.length === 0) return [];
  const outside = lane.points.filter((p) => p.t < t0 || p.t > t1);
  const edges =
    lane.points.length === 0
      ? []
      : [...anchor(lane, range, t0, inner), ...anchor(lane, range, t1, inner)];
  const budget = Math.max(0, MAX_AUTOMATION_POINTS - outside.length - edges.length);
  const cappedInner = inner.length <= budget ? inner : decimateEvenly(inner, budget);
  return [...outside, ...edges, ...cappedInner].sort((a, b) => a.t - b.t);
}
