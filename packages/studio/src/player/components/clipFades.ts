import {
  sampleAutomationLane,
  type HfAutomationLane,
  type HfAutomationPoint,
} from "@hyperframes/core/audio-automation";
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
 * How far a fade may bend away from a straight ramp, either way. Matches the
 * envelope's own limit, since the bend IS an envelope curvature.
 */
const FADE_CURVE_LIMIT = 1;

/** A bend outside the range, or not a number at all, resolves to straight. */
function clampFadeCurve(curve: number): number {
  if (!Number.isFinite(curve)) return 0;
  return Math.max(-FADE_CURVE_LIMIT, Math.min(FADE_CURVE_LIMIT, curve));
}

/**
 * The curvature to store for a bend.
 *
 * A bend and an envelope curvature are the same exponent read from opposite
 * ends: the envelope applies `x^(2^(2·curve))`, and a fade that sags is spelled
 * negative because down is down. One function owns the flip so the grips and
 * the lane can never disagree about which way that is.
 */
function envelopeCurveForFade(curve: number): number {
  // Rounded on the way in. A bend comes off a pointer, so it arrives with every
  // digit a float can hold, and sixteen of them in the markup say nothing a
  // reader or a diff can use.
  return roundToCenti(-clampFadeCurve(curve));
}

/**
 * The bend whose curve passes through `level` at the halfway point, which is
 * how a drag on a fade line resolves to a number: the curve follows the pointer
 * instead of the pointer nudging an abstract parameter.
 */
export function fadeCurveThroughMidpoint(level: number): number {
  const clamped = Math.max(1e-4, Math.min(1 - 1e-4, level));
  // level = 0.5^k  ⇒  k = ln(level) / ln(0.5),  and  k = 2^(-2·bend).
  const k = Math.log(clamped) / Math.log(0.5);
  return clampFadeCurve(-Math.log2(k) / 2);
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

/**
 * The two bends, which are two values and not one.
 *
 * A fade in that creeps out of black and a fade out that drops away is an
 * ordinary thing to ask for, so the ramps are shaped separately. Keyed by the
 * edge they belong to, so a caller with an edge in hand cannot read the wrong
 * one.
 */
export interface ClipFadeCurves {
  in: number;
  out: number;
}

const NO_FADE_CURVES: ClipFadeCurves = { in: 0, out: 0 };

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
 * The bend a stored curvature stands for.
 *
 * A fade and an envelope segment are the same exponent read from opposite ends:
 * a bend of -0.5 sags the line, and the envelope spells that +0.5. This is the
 * inverse of `envelopeCurveForFade`, and they sit together so the two
 * directions of the flip can never drift apart.
 */
export function readFadeCurve(curvature: number | undefined): number {
  return curvature ? -curvature : 0;
}

/**
 * How far each of a clip's ramps is bent.
 *
 * A ramp's curvature lives on the point it leaves, so the numbers are just
 * `points[0]` and the one before last. What matters is the guard: those
 * positions only name a ramp's start when that ramp actually exists. A clip
 * with a fade-in and no fade-out has two points, and the one before last IS the
 * fade-in's own start, so reading it unguarded hands the fade-out a bend it
 * never had. `fades` is the single owner of which ramps exist, so it is what
 * decides whether there is a bend to read at all.
 */
export function readClipFadeCurves(
  points: readonly HfAutomationPoint[],
  fades: ClipFades,
): ClipFadeCurves {
  const sorted = [...points].sort((a, b) => a.t - b.t);
  return {
    in: fades.fadeIn > 0 ? readFadeCurve(sorted[0]?.curve) : 0,
    out: fades.fadeOut > 0 ? readFadeCurve(sorted.at(-2)?.curve) : 0,
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
 * How a fade of this bend rises, read out of the envelope it is stored in.
 *
 * One sampler, because there is now one storage: the wedge on a music clip and
 * the wedge on a video clip are the same line drawn from the same data, not two
 * lookalikes kept in step by hand.
 */
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
  curves: ClipFadeCurves = NO_FADE_CURVES,
  min = 0,
  max = 1,
): HfAutomationPoint[] {
  const { fadeIn, fadeOut } = clampClipFades(fades, duration);
  const existing = readClipFades(points, duration, min, max);
  const headCurvature = envelopeCurveForFade(curves.in);
  const tailCurvature = envelopeCurveForFade(curves.out);

  // Everything strictly between the two fades is the author's; the old fade
  // points are not, so they are dropped by the same window.
  const interiorStart = Math.max(existing.fadeIn, fadeIn);
  const interiorEnd = duration - Math.max(existing.fadeOut, fadeOut);
  const interior = [...points]
    .sort((a, b) => a.t - b.t)
    .filter((p) => p.t > interiorStart + EDGE_EPSILON && p.t < interiorEnd - EDGE_EPSILON);

  const next: HfAutomationPoint[] = [];
  if (fadeIn > 0) {
    next.push({ t: 0, v: min, curve: headCurvature || undefined });
    next.push({ t: roundToCenti(fadeIn), v: max });
  }
  next.push(...interior);
  if (fadeOut > 0) {
    next.push({ t: roundToCenti(duration - fadeOut), v: max, curve: tailCurvature || undefined });
    next.push({ t: roundToCenti(duration), v: min });
  }
  return next;
}
