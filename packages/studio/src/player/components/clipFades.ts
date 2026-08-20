import {
  sampleAutomationLane,
  type HfAutomationLane,
  type HfAutomationPoint,
} from "@hyperframes/core/audio-automation";
import { roundToCenti } from "../../utils/rounding";

/**
 * Fade-handle math: turning the grips on a clip's top corners into the volume
 * envelope underneath them, and back.
 *
 * A fade is not stored as a fade — it is the leading and trailing segment of
 * the clip's ordinary automation envelope. That is what makes the handle
 * two-way: it reads the shape it wrote. It also means a hand-drawn envelope
 * must survive being touched, so every write here rewrites ONLY the head and
 * tail segments and carries whatever the author put between them across
 * untouched.
 */

/** Curve shapes a fade can take, and the segment curvature each one writes. */
export const FADE_CURVES = {
  /** Straight line: the default, and what a constant-power fade is not. */
  linear: 0,
  /** Eases out of silence and into it — the usual choice for music. */
  smooth: 0.35,
  /** Holds the level then drops late; useful under a voice. */
  sharp: -0.45,
} as const;

export type FadeCurve = keyof typeof FADE_CURVES;

/** Shortest fade the handle will write; below this it reads as "no fade". */
export const MIN_FADE_SECONDS = 0.05;

/** Values within this of the floor/ceiling count as silence / full level. */
const LEVEL_EPSILON = 1e-3;
/** Times within this of the clip edge count as sitting on it. */
const EDGE_EPSILON = 1e-3;

export interface ClipFades {
  /** Seconds of fade at the clip's head; 0 when there is none. */
  fadeIn: number;
  /** Seconds of fade at the clip's tail; 0 when there is none. */
  fadeOut: number;
}

export const NO_FADES: ClipFades = { fadeIn: 0, fadeOut: 0 };

const atFloor = (v: number, min: number) => Math.abs(v - min) <= LEVEL_EPSILON;
const atCeiling = (v: number, max: number) => Math.abs(v - max) <= LEVEL_EPSILON;

/**
 * Read the fades out of an envelope, conservatively: a head segment counts as a
 * fade-in only when it starts at the clip's first frame, starts at silence, and
 * rises to full level. Anything else is somebody's automation and is reported
 * as no fade, so the handle never claims to own a curve it would flatten.
 */
export function readClipFades(
  points: readonly HfAutomationPoint[],
  duration: number,
  min = 0,
  max = 1,
): ClipFades {
  if (points.length < 2 || duration <= 0) return NO_FADES;
  const sorted = [...points].sort((a, b) => a.t - b.t);
  const first = sorted[0]!;
  const second = sorted[1]!;
  const last = sorted[sorted.length - 1]!;
  const penultimate = sorted[sorted.length - 2]!;

  const fadeIn =
    first.t <= EDGE_EPSILON && atFloor(first.v, min) && atCeiling(second.v, max)
      ? Math.max(0, second.t)
      : 0;
  // `>=`, not `≈`: trimming a clip shorter leaves its envelope addressed to the
  // old length, and a fade that still reaches past the new end is a fade the
  // author can still see and grab. Reporting it as gone would hide a curve the
  // clip is still carrying.
  const fadeOut =
    last.t >= duration - EDGE_EPSILON &&
    atFloor(last.v, min) &&
    atCeiling(penultimate.v, max) &&
    // The same two points cannot be both fades; a two-point ramp is one or the
    // other, and the head reading wins because it is the one the eye reads first.
    !(fadeIn > 0 && sorted.length === 2)
      ? Math.max(0, Math.min(duration, duration - penultimate.t))
      : 0;

  return {
    fadeIn: fadeIn >= MIN_FADE_SECONDS ? roundToCenti(fadeIn) : 0,
    fadeOut: fadeOut >= MIN_FADE_SECONDS ? roundToCenti(fadeOut) : 0,
  };
}

/**
 * The longest each fade may be: together they may not overlap, and each is
 * capped at the clip. Split evenly when both are dragged past the middle, so a
 * long fade-in shortens the room left for a fade-out rather than fighting it.
 */
export function clampClipFades(fades: ClipFades, duration: number): ClipFades {
  const fadeIn = Math.max(0, Math.min(fades.fadeIn, duration));
  const fadeOut = Math.max(0, Math.min(fades.fadeOut, duration));
  if (fadeIn + fadeOut <= duration) {
    return {
      fadeIn: fadeIn >= MIN_FADE_SECONDS ? roundToCenti(fadeIn) : 0,
      fadeOut: fadeOut >= MIN_FADE_SECONDS ? roundToCenti(fadeOut) : 0,
    };
  }
  // Overlapping: give each what it asked for, in proportion, so neither jumps.
  const total = fadeIn + fadeOut;
  return clampClipFades(
    { fadeIn: (fadeIn / total) * duration, fadeOut: (fadeOut / total) * duration },
    duration,
  );
}

/**
 * The two SVG paths a fade draws, as one pair so they cannot disagree:
 *
 * - `line` is the level itself, and the only thing that gets stroked. It is an
 *   open path: stroking a closed wedge outlines the fill's straight top and
 *   side too, which reads as a rectangle butted onto the curve.
 * - `fill` is that same line closed back to the clip's corner — the region the
 *   fade takes away — and is never stroked.
 *
 * Both are sampled through the interpolator the runtime plays back, so a curved
 * fade is drawn as the curve it will sound like rather than a straight line
 * standing in for one.
 */
export function fadeWedgePath(input: {
  edge: "in" | "out";
  seconds: number;
  curve: FadeCurve;
  pixelsPerSecond: number;
  width: number;
  height: number;
}): { line: string; fill: string } {
  const { edge, seconds, curve, pixelsPerSecond, width, height } = input;
  const span = Math.min(seconds * pixelsPerSecond, width);
  if (span <= 0) return { line: "", fill: "" };
  const curvature = FADE_CURVES[curve];
  const lane: HfAutomationLane = {
    target: "volume",
    points:
      edge === "in"
        ? [
            { t: 0, v: 0, curve: curvature || undefined },
            { t: seconds, v: 1 },
          ]
        : [
            { t: 0, v: 1, curve: curvature || undefined },
            { t: seconds, v: 0 },
          ],
  };
  // Both wedges are drawn left to right, which is the direction the level line
  // is read in: a fade-in rises out of the clip's start, a fade-out falls into
  // its end. The out wedge therefore begins `span` short of the right edge, not
  // at it — drawing it from the edge inward mirrors the fade.
  const xAt = (progress: number) =>
    edge === "in" ? span * progress : width - span * (1 - progress);
  const steps = curvature === 0 ? 1 : WEDGE_SAMPLES;
  const points: string[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const progress = i / steps;
    const level = sampleAutomationLane(lane, seconds * progress, "linear");
    points.push(`${xAt(progress).toFixed(2)} ${((1 - level) * height).toFixed(2)}`);
  }
  const line = `M ${points.join(" L ")}`;
  // The fill closes through the clip's own corner: up to the top for a fade-in,
  // back along the top for a fade-out. Never stroked, so those closing edges
  // stay invisible and only the level reads as a line.
  const corner = edge === "in" ? 0 : width;
  return { line, fill: `${line} L ${corner} 0 Z` };
}

/** Segments used to draw a curved wedge; a straight one needs no sampling. */
const WEDGE_SAMPLES = 24;

/**
 * Rewrite the envelope's head and tail to match `fades`, keeping every point
 * the author placed in between. Returns an empty list when there is nothing
 * left to describe — the caller drops the lane rather than storing a flat line.
 */
export function writeClipFades(
  points: readonly HfAutomationPoint[],
  duration: number,
  fades: ClipFades,
  curve: FadeCurve = "linear",
  min = 0,
  max = 1,
): HfAutomationPoint[] {
  const { fadeIn, fadeOut } = clampClipFades(fades, duration);
  const existing = readClipFades(points, duration, min, max);
  const curvature = FADE_CURVES[curve];

  // Everything strictly between the two fades is the author's; the old fade
  // points are not, so they are dropped by the same window.
  const interiorStart = Math.max(existing.fadeIn, fadeIn);
  const interiorEnd = duration - Math.max(existing.fadeOut, fadeOut);
  const interior = [...points]
    .sort((a, b) => a.t - b.t)
    .filter((p) => p.t > interiorStart + EDGE_EPSILON && p.t < interiorEnd - EDGE_EPSILON);

  const next: HfAutomationPoint[] = [];
  if (fadeIn > 0) {
    next.push({ t: 0, v: min, curve: curvature || undefined });
    next.push({ t: roundToCenti(fadeIn), v: max });
  }
  next.push(...interior);
  if (fadeOut > 0) {
    next.push({ t: roundToCenti(duration - fadeOut), v: max, curve: curvature || undefined });
    next.push({ t: roundToCenti(duration), v: min });
  }
  return next;
}
