import {
  sampleAutomationLane,
  type HfAutomationLane,
  type HfAutomationPoint,
} from "@hyperframes/core/audio-automation";
import { clampFadeCurve, fadeEase } from "@hyperframes/core/clip-fade";
import { roundToCenti } from "../../utils/rounding";

/**
 * Fade-handle math, shared by both kinds of clip.
 *
 * The two store a fade in the place their medium already keeps that kind of
 * information, and this module is what lets one gesture drive both:
 *
 * - **Visual** clips carry `data-fade-in` / `data-fade-out`, which the runtime
 *   applies. The curve is one of the runtime's own easings.
 * - **Audio** clips carry the fade as the leading and trailing segment of their
 *   volume envelope, so it stays editable as breakpoints afterwards. The curve
 *   is the envelope's own segment curvature.
 *
 * Everything below is about the lengths, which behave identically either way;
 * only the sampler used to DRAW the fade differs, and that is passed in.
 */

/**
 * The envelope curvature that reproduces a fade bend exactly.
 *
 * The two systems already parameterise a curve the same way, as an exponent:
 * a fade is `p^(2^(-2·bend))` and an envelope segment is `x^(2^(2·curve))`.
 * They differ only in which direction counts as positive, so the conversion is
 * a sign flip and an audio fade is the same shape as the visual one, not an
 * approximation of it. One function owns that flip.
 */
function envelopeCurveForFade(curve: number): number {
  return -clampFadeCurve(curve);
}

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
 * Read the fades out of a volume envelope, conservatively: a head segment counts
 * as a fade-in only when it starts at the clip's first frame, starts at silence,
 * and rises to full level. Anything else is somebody's automation and is
 * reported as no fade, so the handle never claims to own a curve it would
 * flatten.
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
 * capped at the clip. Split in proportion when both are dragged past the middle,
 * so a long fade-in shortens the room left for a fade-out rather than fighting
 * it — the same rule the runtime applies when it plays them.
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
  const total = fadeIn + fadeOut;
  return clampClipFades(
    { fadeIn: (fadeIn / total) * duration, fadeOut: (fadeOut / total) * duration },
    duration,
  );
}

/** How a fade's level rises across its length, for whichever medium draws it. */
export type FadeSampler = (progress: number) => number;

/**
 * How a fade of this bend rises, for drawing it. One sampler for both media:
 * `envelopeCurveForFade` makes the audio envelope trace the same curve the
 * runtime fades a picture along, so the wedge on a music clip and the wedge on
 * a video clip are the same line and not two lookalikes.
 */
export function fadeSampler(curve: number): FadeSampler {
  return (progress) => fadeEase(progress, curve);
}

/** The same rise, read back out of the envelope an audio fade is stored in. */
export function envelopeFadeSampler(curve: number): FadeSampler {
  const lane: HfAutomationLane = {
    target: "volume",
    points: [
      { t: 0, v: 0, curve: envelopeCurveForFade(curve) || undefined },
      { t: 1, v: 1 },
    ],
  };
  return (progress) => sampleAutomationLane(lane, progress, "linear");
}

/** Segments a wedge is drawn with; enough that any easing reads smooth. */
const WEDGE_SAMPLES = 24;

/**
 * The two SVG paths a fade draws, as one pair so they cannot disagree:
 *
 * - `line` is the level itself, and the only thing that gets stroked. It is an
 *   open path: stroking a closed wedge outlines the fill's straight top and
 *   side too, which reads as a rectangle butted onto the curve.
 * - `fill` is that same line closed back to the clip's corner — the region the
 *   fade takes away — and is never stroked.
 */
export function fadeWedgePath(input: {
  edge: "in" | "out";
  seconds: number;
  sample: FadeSampler;
  pixelsPerSecond: number;
  width: number;
  height: number;
}): { line: string; fill: string } {
  const { edge, seconds, sample, pixelsPerSecond, width, height } = input;
  const span = Math.min(seconds * pixelsPerSecond, width);
  if (span <= 0) return { line: "", fill: "" };
  // Both wedges are drawn left to right, which is the direction the level line
  // is read in: a fade-in rises out of the clip's start, a fade-out falls into
  // its end. The out wedge therefore begins `span` short of the right edge.
  const xAt = (progress: number) =>
    edge === "in" ? span * progress : width - span * (1 - progress);
  // Always sampled, never "detect a straight line and shortcut it": every
  // symmetric easing passes through 0.5 at its midpoint, so the obvious probe
  // says smoothstep is a straight line and draws it as one.
  const points: string[] = [];
  for (let i = 0; i <= WEDGE_SAMPLES; i += 1) {
    const progress = i / WEDGE_SAMPLES;
    // A fade-out is the same rise read backwards.
    const level = edge === "in" ? sample(progress) : sample(1 - progress);
    points.push(`${xAt(progress).toFixed(2)} ${((1 - level) * height).toFixed(2)}`);
  }
  const line = `M ${points.join(" L ")}`;
  // The fill closes through the clip's own corner. Never stroked, so those
  // closing edges stay invisible and only the level reads as a line.
  const corner = edge === "in" ? 0 : width;
  return { line, fill: `${line} L ${corner} 0 Z` };
}

/**
 * Rewrite a volume envelope's head and tail to match `fades`, keeping every
 * point the author placed in between. Returns an empty list when there is
 * nothing left to describe — the caller drops the lane rather than storing a
 * flat line. Audio only; a visual fade is two attributes, not an envelope.
 */
export function writeClipFades(
  points: readonly HfAutomationPoint[],
  duration: number,
  fades: ClipFades,
  curve = 0,
  min = 0,
  max = 1,
): HfAutomationPoint[] {
  const { fadeIn, fadeOut } = clampClipFades(fades, duration);
  const existing = readClipFades(points, duration, min, max);
  const curvature = envelopeCurveForFade(curve);

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
