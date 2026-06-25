/**
 * Convert a live tween (from `readRuntimeKeyframes`) into renderable motion-path
 * geometry for the on-canvas overlay. Pure — no React/DOM — so it unit-tests in
 * isolation. Coordinates are in composition space (the same space the overlay's
 * viewBox uses), so the caller renders nodes/points directly.
 */
import type { ReadTween } from "../../hooks/gsapRuntimeKeyframes";

/** Which source edit a dragged node maps to. */
export type MotionNodeRef =
  | { type: "keyframe"; pct: number } // x/y position keyframe at this tween-relative %
  | { type: "waypoint"; index: number }; // motionPath waypoint (anchor) at this index

export interface MotionPathNode {
  x: number;
  y: number;
  ref: MotionNodeRef;
}

export interface MotionPathGeometry {
  /** "linear" = x/y keyframes; "arc" = motionPath tween. */
  kind: "linear" | "arc";
  /** SVG polyline points: "x,y x,y ...". */
  points: string;
  nodes: MotionPathNode[];
}

/**
 * Build motion-path geometry, or null when the tween carries no positional path
 * (fewer than two keyframes with both x and y). For motionPath tweens the
 * keyframes are the arc waypoints (anchors), index-aligned with the source path
 * — so a waypoint node at index `i` rewrites source waypoint `i`.
 *
 * ponytail: the arc is drawn as a polyline through its waypoints (matching the
 * angular dotted look of the reference), not GSAP's resolved curve. Dense
 * curve sampling is a later refinement if the straight-segment preview proves
 * insufficient.
 */
/**
 * Nearest point on a polyline to (px, py), with the index of the segment it
 * lies on and `t` = how far along that segment the returned point sits.
 *
 * `t` semantics: clamped to the inclusive range [0, 1].
 *   - `t === 0` → the point is at (or projects before) the segment's start node
 *     (`segIndex`); a perpendicular dropped from (px, py) falls at or behind `a`.
 *   - `0 < t < 1` → the point is strictly interior to the segment.
 *   - `t === 1` → the point is at (or projects PAST) the segment's end node
 *     (`segIndex + 1`); past-the-end projections are clamped back onto the endpoint,
 *     so the returned (x, y) is exactly `nodes[segIndex + 1]`. Callers can read
 *     `t === 1` as "snapped to the end anchor of this segment" (equivalently, the
 *     start anchor of the next segment).
 * A degenerate zero-length segment (`a === b`) yields `t === 0`.
 *
 * Used to position the ghost "add" node and decide where a new node goes: a
 * motionPath waypoint inserts between `segIndex`/`segIndex + 1`, a keyframe
 * interpolates its tween-% from the two adjacent keyframes via `t`.
 * Coordinates are whatever space the caller passes (overlay uses absolute px).
 */
export function nearestPointOnPath(
  px: number,
  py: number,
  nodes: Array<{ x: number; y: number }>,
): { x: number; y: number; segIndex: number; t: number; dist: number } | null {
  if (nodes.length < 2) return null;
  let best: { x: number; y: number; segIndex: number; t: number; dist: number } | null = null;
  for (let i = 0; i < nodes.length - 1; i++) {
    const a = nodes[i]!;
    const b = nodes[i + 1]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / len2));
    const cx = a.x + t * dx;
    const cy = a.y + t * dy;
    const dist = Math.hypot(px - cx, py - cy);
    if (!best || dist < best.dist) best = { x: cx, y: cy, segIndex: i, t, dist };
  }
  return best;
}

export function buildMotionPathGeometry(read: ReadTween | null): MotionPathGeometry | null {
  if (!read) return null;
  const isArc = Boolean(read.arcPath);
  const nodes: MotionPathNode[] = [];

  // Index by source position so a waypoint node maps to the matching source
  // anchor. Arc waypoints always carry x/y (never filtered), so source index
  // and node order stay aligned.
  // Which axes does the tween animate at all? A single-axis tween (e.g.
  // `to({ x: -260 })`) only carries x; its y stays at the base (0, the GSAP
  // transform identity), so we default it and still draw a path. But if the tween
  // DOES animate an axis and a given keyframe omits it, that value is interpolated
  // (not 0) and can't be placed here → skip that node (the prior behavior).
  const finite = (v: unknown): v is number => typeof v === "number" && isFinite(v);
  const tweenHasX = read.keyframes.some((kf) => finite(kf.properties.x));
  const tweenHasY = read.keyframes.some((kf) => finite(kf.properties.y));
  if (!tweenHasX && !tweenHasY) return null; // no positional motion (opacity/scale only)

  read.keyframes.forEach((kf, i) => {
    if (tweenHasX && !finite(kf.properties.x)) return;
    if (tweenHasY && !finite(kf.properties.y)) return;
    nodes.push({
      x: tweenHasX ? (kf.properties.x as number) : 0,
      y: tweenHasY ? (kf.properties.y as number) : 0,
      ref: isArc ? { type: "waypoint", index: i } : { type: "keyframe", pct: kf.percentage },
    });
  });

  if (nodes.length < 2) return null;

  return {
    kind: isArc ? "arc" : "linear",
    points: nodes.map((n) => `${n.x},${n.y}`).join(" "),
    nodes,
  };
}
