import type { TimelineElement } from "../store/playerStore";

export type TimelineSnapKind = "beat" | "edge" | "playhead" | "bound";

export interface TimelineSnapTarget {
  time: number;
  kind: TimelineSnapKind;
}

interface NearestSnap {
  target: TimelineSnapTarget;
  distance: number;
}

const SNAP_PX = 8;
const DEDUPE_EPSILON_SECONDS = 0.001;
const ROUND_FACTOR = 1000;
const KIND_PRIORITY: Record<TimelineSnapKind, number> = {
  bound: 0,
  playhead: 1,
  edge: 2,
  beat: 3,
};

function roundToMillis(value: number): number {
  return Math.round(value * ROUND_FACTOR) / ROUND_FACTOR;
}

function addTarget(targets: TimelineSnapTarget[], candidate: TimelineSnapTarget) {
  if (!Number.isFinite(candidate.time)) return;
  const existingIndex = targets.findIndex(
    (target) => Math.abs(target.time - candidate.time) < DEDUPE_EPSILON_SECONDS,
  );
  if (existingIndex === -1) {
    targets.push(candidate);
    return;
  }

  const existing = targets[existingIndex];
  if (!existing || KIND_PRIORITY[candidate.kind] >= KIND_PRIORITY[existing.kind]) return;
  targets[existingIndex] = candidate;
}

export function buildTimelineSnapTargets(input: {
  elements: TimelineElement[];
  /** Keys of every clip moving in this gesture (the whole group), excluded as targets. */
  excludedKeys: ReadonlySet<string>;
  playhead: number;
  compDuration: number;
  beats: number[];
}): TimelineSnapTarget[] {
  const targets: TimelineSnapTarget[] = [];

  addTarget(targets, { time: 0, kind: "bound" });
  addTarget(targets, { time: Math.max(0, input.compDuration), kind: "bound" });
  addTarget(targets, { time: Math.max(0, input.playhead), kind: "playhead" });

  for (const element of input.elements) {
    const elementKey = element.key ?? element.id;
    if (input.excludedKeys.has(elementKey) || input.excludedKeys.has(element.id)) continue;
    addTarget(targets, { time: element.start, kind: "edge" });
    addTarget(targets, { time: element.start + element.duration, kind: "edge" });
  }

  for (const beat of input.beats) {
    addTarget(targets, { time: beat, kind: "beat" });
  }

  return targets.sort((a, b) => a.time - b.time || KIND_PRIORITY[a.kind] - KIND_PRIORITY[b.kind]);
}

function nearestSnap(
  time: number,
  targets: TimelineSnapTarget[],
  thresholdSeconds: number,
): NearestSnap | null {
  let best: NearestSnap | null = null;
  let bestDistance = thresholdSeconds;
  for (const target of targets) {
    if (target.time === time) continue;
    const distance = Math.abs(target.time - time);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = { target, distance };
    }
  }
  return best;
}

export function snapEdgesToTargets(
  start: number,
  duration: number,
  targets: TimelineSnapTarget[],
  pixelsPerSecond: number,
  options?: { maxStart?: number },
): { start: number; snapTime: number | null; snapKind: TimelineSnapKind | null } {
  const thresholdSeconds = SNAP_PX / Math.max(pixelsPerSecond, 1);
  const startSnap = nearestSnap(start, targets, thresholdSeconds);
  const endSnap = nearestSnap(start + duration, targets, thresholdSeconds);

  let candidate = start;
  let snapTarget: TimelineSnapTarget | null = null;
  if (startSnap && (!endSnap || startSnap.distance <= endSnap.distance)) {
    candidate = startSnap.target.time;
    snapTarget = startSnap.target;
  } else if (endSnap) {
    candidate = endSnap.target.time - duration;
    snapTarget = endSnap.target;
  }

  const maxStart = options?.maxStart ?? Number.POSITIVE_INFINITY;
  const upperStart = Number.isFinite(maxStart) ? Math.max(0, maxStart) : Number.POSITIVE_INFINITY;
  const clamped = Math.max(0, Math.min(upperStart, roundToMillis(candidate)));
  if (snapTarget && Math.abs(clamped - candidate) > 1e-6) {
    return { start: clamped, snapTime: null, snapKind: null };
  }
  return {
    start: clamped,
    snapTime: snapTarget?.time ?? null,
    snapKind: snapTarget?.kind ?? null,
  };
}

export function snapResizeEdgeToTargets(
  edge: "start" | "end",
  start: number,
  duration: number,
  targets: TimelineSnapTarget[],
  pixelsPerSecond: number,
  limits: { minDuration: number; maxEnd: number; maxLeftDelta?: number },
): { start: number; duration: number; snapTime: number | null; snapKind: TimelineSnapKind | null } {
  const thresholdSeconds = SNAP_PX / Math.max(pixelsPerSecond, 1);

  if (edge === "end") {
    const snap = nearestSnap(start + duration, targets, thresholdSeconds);
    if (!snap) return { start, duration, snapTime: null, snapKind: null };
    const snappedDuration = roundToMillis(snap.target.time - start);
    if (snap.target.time > limits.maxEnd + 1e-6 || snappedDuration < limits.minDuration) {
      return { start, duration, snapTime: null, snapKind: null };
    }
    return {
      start,
      duration: snappedDuration,
      snapTime: snap.target.time,
      snapKind: snap.target.kind,
    };
  }

  const snap = nearestSnap(start, targets, thresholdSeconds);
  if (!snap) return { start, duration, snapTime: null, snapKind: null };
  const snappedStart = roundToMillis(snap.target.time);
  const delta = start - snappedStart;
  const snappedDuration = roundToMillis(duration + delta);
  const maxLeftDelta = limits.maxLeftDelta ?? Number.POSITIVE_INFINITY;
  if (snappedStart < 0 || delta > maxLeftDelta + 1e-6 || snappedDuration < limits.minDuration) {
    return { start, duration, snapTime: null, snapKind: null };
  }
  return {
    start: snappedStart,
    duration: snappedDuration,
    snapTime: snap.target.time,
    snapKind: snap.target.kind,
  };
}
