/**
 * Sub-frame multi-sample motion blur (issue #4010).
 *
 * For each output frame the capture path seeks the timeline to K sub-frame times spread
 * across the shutter window, captures each, and averages them. Unlike the catalog
 * component, which stacks offset copies of an element and can only integrate
 * translation, re-rendering at each sample integrates whatever the composition actually
 * does inside the window: rotation, scale, opacity, filters, child animation.
 *
 * Shutter window, the After Effects model, in frames rather than seconds so the sample
 * offsets are frame-rate independent:
 *
 *   shutterTime = shutterAngle / 360 / fps
 *   windowStart = t + shutterPhase / 360 / fps
 *   sample k at  windowStart + (k + 0.5) / N * shutterTime
 */

import { decodePng, srgbByteToLinear } from "../utils/alphaBlit.js";

/** Caller-facing options. Presence of the object is the opt-in; there is no enabled flag. */
export interface MotionBlurOptions {
  /** Sub-frame captures averaged into one output frame. Default 16, clamped to 1..64. */
  samplesPerFrame?: number;
  /** Shutter window width in degrees of one frame. Default 180, AE's default. */
  shutterAngle?: number;
  /** Window offset in degrees. Default -90, which centres the window on the frame time. */
  shutterPhase?: number;
  /**
   * Working space for the average. Default "srgb", matching After Effects' non-linearised
   * 8-bpc working space and the catalog component. "linear" is physically correct light
   * integration and diverges from both on high-contrast edges.
   */
  blend?: MotionBlurBlendSpace;
}

export type MotionBlurBlendSpace = "srgb" | "linear";

/** A resolved plan. The window is fixed by shutter angle/phase alone, independent of
 * how many samples fill it, which is what lets the count vary per frame. */
export interface MotionBlurPlan {
  readonly blend: MotionBlurBlendSpace;
  /**
   * Sub-frame ticks per output frame. The seek grid is `fps * subFrameDivisions`, which
   * contains the output frame grid, so the frame-time instant never moves.
   */
  readonly subFrameDivisions: number;
  /** Window start, in frames relative to the frame instant (`shutterPhase / 360`). */
  readonly windowStartFrames: number;
  /** Window width, in frames (`shutterAngle / 360`). */
  readonly shutterFrames: number;
  /** Explicit count from the caller (clamped to 1..64), or null for adaptive per-frame. */
  readonly fixedSamplesPerFrame: number | null;
}

export const MAX_SAMPLES_PER_FRAME = 64;

/** Sample count for a frame confirmed to need no measurement (the adaptive floor, and
 * the count an explicit `samplesPerFrame` defaults to). */
export const DEFAULT_SAMPLES_PER_FRAME = 16;
const DEFAULT_SHUTTER_ANGLE = 180;
const DEFAULT_SHUTTER_PHASE = -90;

/**
 * Ticks per output frame on the seek grid. Fine enough that the rounding error on a
 * sample time is under 1/8192 of a frame, coarse enough to stay exactly representable.
 */
const SUB_FRAME_DIVISIONS = 4096;

function finiteOr(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) ? (value as number) : fallback;
}

/** Resolve caller options into a plan, or null when motion blur is off. */
export function resolveMotionBlurPlan(
  options: MotionBlurOptions | undefined,
): MotionBlurPlan | null {
  if (!options) return null;

  const fixedSamplesPerFrame =
    options.samplesPerFrame === undefined
      ? null
      : Math.min(
          MAX_SAMPLES_PER_FRAME,
          Math.max(1, Math.round(finiteOr(options.samplesPerFrame, DEFAULT_SAMPLES_PER_FRAME))),
        );
  const shutterAngle = finiteOr(options.shutterAngle, DEFAULT_SHUTTER_ANGLE);
  const shutterPhase = finiteOr(options.shutterPhase, DEFAULT_SHUTTER_PHASE);
  const blend: MotionBlurBlendSpace = options.blend === "linear" ? "linear" : "srgb";

  return {
    blend,
    subFrameDivisions: SUB_FRAME_DIVISIONS,
    windowStartFrames: shutterPhase / 360,
    shutterFrames: shutterAngle / 360,
    fixedSamplesPerFrame,
  };
}

/** Tick offsets from the frame instant for `samplesPerFrame` samples spread evenly
 * across the plan's window, ascending. Integers, so every host agrees. */
function sampleTickOffsets(plan: MotionBlurPlan, samplesPerFrame: number): number[] {
  const offsets: number[] = [];
  for (let k = 0; k < samplesPerFrame; k++) {
    const offsetFrames =
      plan.windowStartFrames + ((k + 0.5) / samplesPerFrame) * plan.shutterFrames;
    offsets.push(Math.round(offsetFrames * plan.subFrameDivisions));
  }
  return offsets;
}

/**
 * Absolute seek times for one output frame, in ascending order, for `samplesPerFrame`
 * samples spread across the plan's window (independent of `plan.fixedSamplesPerFrame` —
 * the caller decides how many samples this particular frame gets).
 *
 * Built from integer ticks rather than by adding floats to `frameIndex / fps`, so the
 * page-side quantizer recovers the intended tick exactly on every host. Times before the
 * composition start clamp to 0, which is what After Effects does at the first frame.
 */
export function motionBlurSampleTimes(
  plan: MotionBlurPlan,
  frameIndex: number,
  fps: number,
  samplesPerFrame: number,
): number[] {
  const grid = fps * plan.subFrameDivisions;
  const frameTicks = frameIndex * plan.subFrameDivisions;
  return sampleTickOffsets(plan, samplesPerFrame).map(
    (offset) => Math.max(0, frameTicks + offset) / grid,
  );
}

/** The two true shutter-window edges (not samples — see `motionBlurProbeTimes`'s
 * caller), for measuring motion magnitude before a sample count is chosen. */
export function motionBlurProbeTimes(
  plan: MotionBlurPlan,
  frameIndex: number,
  fps: number,
): {
  windowStart: number;
  windowEnd: number;
} {
  const grid = fps * plan.subFrameDivisions;
  const frameTicks = frameIndex * plan.subFrameDivisions;
  const startTick = Math.round(plan.windowStartFrames * plan.subFrameDivisions);
  const endTick = Math.round(
    (plan.windowStartFrames + plan.shutterFrames) * plan.subFrameDivisions,
  );
  return {
    windowStart: Math.max(0, frameTicks + startTick) / grid,
    windowEnd: Math.max(0, frameTicks + endTick) / grid,
  };
}

/**
 * Is every frame the shutter window reads from known static, so this frame can reuse its
 * predecessor's buffer instead of paying K captures?
 *
 * The static-frame dedup asks whether a frame is byte-identical to the one before it. With
 * blur on that is not enough: the window reads content from either side of the frame
 * instant, so a still frame next to a moving one still has to be captured. At a shutter
 * angle above 360 the window spans whole neighbouring frames and the reuse would drop a
 * frame of motion outright.
 *
 * The range covers the previous frame's window too, because reuse claims this frame's
 * blurred output equals that one's. Contract taken from #4013 by Dante-dan, which carried
 * this guard before we did.
 */
export function motionBlurWindowIsStatic(
  plan: MotionBlurPlan,
  frameIndex: number,
  staticFrames: ReadonlySet<number>,
): boolean {
  // Bound by the outermost sample this frame could take (its half-step inset from the
  // true edge), not the edge itself. An adaptive plan's K is unknown here, so use the
  // widest possible inset (K=64) rather than the true edge, which any chosen K stays inside.
  const worstCaseSamples = plan.fixedSamplesPerFrame ?? MAX_SAMPLES_PER_FRAME;
  const inset = plan.shutterFrames / (2 * worstCaseSamples);
  const minOffsetFrames = plan.windowStartFrames + inset;
  const maxOffsetFrames = plan.windowStartFrames + plan.shutterFrames - inset;
  const first = Math.floor(frameIndex - 1 + Math.min(0, minOffsetFrames));
  // A sample landing inside [F, F+1) reads content the frame set only pins down at both
  // ends, so the frame after the last one touched has to be static as well.
  const last = Math.floor(frameIndex + Math.max(0, maxOffsetFrames)) + 1;
  for (let frame = first; frame <= last; frame++) {
    if (!staticFrames.has(frame)) return false;
  }
  return true;
}

/** Diff magnitude → sample count, ascending and exhaustive. Calibration provenance and
 * measured numbers are in the PR description for #4029; the 32-sample step is
 * interpolated, not independently measured. */
export const ADAPTIVE_SAMPLE_STEPS: ReadonlyArray<{
  readonly maxDiff: number;
  readonly samples: number;
}> = [
  { maxDiff: 3, samples: DEFAULT_SAMPLES_PER_FRAME },
  { maxDiff: 6, samples: 32 },
  { maxDiff: Infinity, samples: MAX_SAMPLES_PER_FRAME },
];

/** Sample count for a frame whose probe diff magnitude is `diff` (see `ADAPTIVE_SAMPLE_STEPS`). */
export function adaptiveSampleCount(diff: number): number {
  for (const step of ADAPTIVE_SAMPLE_STEPS) {
    if (diff <= step.maxDiff) return step.samples;
  }
  return MAX_SAMPLES_PER_FRAME;
}

/** GSAP property names that move an element in screen space. Matches the Transform
 * categories of SUPPORTED_PROPS in packages/parsers/src/gsapConstants.ts, minus
 * transformOrigin (that file's own classifyTweenPropertyGroup excludes it: a pivot-point
 * modifier, not independent motion). Passed into computeStaticFrameSet's page.evaluate as data. */
export const SPATIAL_TWEEN_PROPERTIES: readonly string[] = [
  "x",
  "y",
  "z",
  "xPercent",
  "yPercent",
  "rotation",
  "rotate",
  "rotationX",
  "rotationY",
  "rotationZ",
  "scale",
  "scaleX",
  "scaleY",
  "scaleZ",
  "skewX",
  "skewY",
  "perspective",
  "transformPerspective",
  "top",
  "left",
  "right",
  "bottom",
  "width",
  "height",
  "translate",
  "translateX",
  "translateY",
  "translateZ",
  "transform",
];

/** Mean absolute byte difference between two probe captures (never a sample that
 * enters the average) — the motion signal `adaptiveSampleCount` maps to a count. */
export function probeDiffMagnitude(a: Buffer, b: Buffer): number {
  const decodedA = decodePng(a);
  const decodedB = decodePng(b);
  if (decodedA.width !== decodedB.width || decodedA.height !== decodedB.height) {
    throw new Error(
      `probeDiffMagnitude: sample geometry mismatch (${decodedA.width}x${decodedA.height} vs ${decodedB.width}x${decodedB.height})`,
    );
  }
  let sum = 0;
  for (let i = 0; i < decodedA.data.length; i++) {
    sum += Math.abs((decodedA.data[i] as number) - (decodedB.data[i] as number));
  }
  return sum / decodedA.data.length;
}

const SRGB_TO_LINEAR = (() => {
  const lut = new Float64Array(256);
  for (let i = 0; i < 256; i++) lut[i] = srgbByteToLinear(i);
  return lut;
})();

/**
 * Identity table for the sRGB working space, so the accumulate loop is one shape for both
 * spaces instead of two near-copies. Measured on a 1920x1080 frame at 16 samples, reading
 * this table costs nothing against using the byte directly: the two variants time within
 * each other's run-to-run noise.
 */
const SRGB_PASSTHROUGH = (() => {
  const lut = new Float64Array(256);
  for (let i = 0; i < 256; i++) lut[i] = i;
  return lut;
})();

function linearToByte(value: number): number {
  const c = value <= 0.0031308 ? value * 12.92 : 1.055 * Math.pow(value, 1 / 2.4) - 0.055;
  return clampByte(c * 255);
}

function clampByte(value: number): number {
  return Math.min(255, Math.max(0, Math.round(value)));
}

/**
 * Running average of the sub-frame captures for one output frame.
 *
 * Samples are folded in as they arrive rather than held until the end, so peak memory is
 * one accumulator plus one decoded sample regardless of K. Holding all K decoded frames
 * would be (K + 1) * 8.3 MB at 1080p, which is 141 MB at the default 16 samples and
 * 540 MB at the 64 maximum, thrown away and rebuilt on every frame of the render.
 *
 * Colour is summed premultiplied by alpha and un-premultiplied at the end, so a sample
 * that is transparent at a pixel contributes no colour there. On opaque frames, the
 * common case, that reduces to a plain mean.
 */
export class MotionBlurAccumulator {
  private readonly toWorking: Float64Array;
  private readonly fromWorking: (value: number) => number;
  /** Premultiplied r, g, b and alpha sums per pixel. Null until the first sample sets the size. */
  private sums: Float32Array | null = null;
  private width = 0;
  private height = 0;
  private count = 0;

  constructor(blend: MotionBlurBlendSpace) {
    this.toWorking = blend === "linear" ? SRGB_TO_LINEAR : SRGB_PASSTHROUGH;
    this.fromWorking = blend === "linear" ? linearToByte : clampByte;
  }

  /** Fold one captured sample PNG into the running average. */
  add(png: Buffer): void {
    const { width, height, data } = decodePng(png);
    if (!this.sums) {
      this.width = width;
      this.height = height;
      // float32 holds a 64-sample premultiplied sum (max 16320) far more precisely than
      // the 1/255 quantum the result is rounded to.
      this.sums = new Float32Array(width * height * 4);
    } else if (width !== this.width || height !== this.height) {
      throw new Error(
        `MotionBlurAccumulator: sample geometry mismatch (${width}x${height} vs ${this.width}x${this.height})`,
      );
    }

    const sums = this.sums;
    const toWorking = this.toWorking;
    for (let i = 0; i < sums.length; i += 4) {
      const alpha = (data[i + 3] as number) / 255;
      sums[i] = (sums[i] as number) + (toWorking[data[i] as number] as number) * alpha;
      sums[i + 1] = (sums[i + 1] as number) + (toWorking[data[i + 1] as number] as number) * alpha;
      sums[i + 2] = (sums[i + 2] as number) + (toWorking[data[i + 2] as number] as number) * alpha;
      sums[i + 3] = (sums[i + 3] as number) + alpha;
    }
    this.count += 1;
  }

  /** Un-premultiply and encode the average. Throws if no sample was ever added. */
  finish(): { width: number; height: number; data: Uint8Array } {
    const sums = this.sums;
    if (!sums) throw new Error("MotionBlurAccumulator: no samples");

    const out = new Uint8Array(sums.length);
    for (let i = 0; i < sums.length; i += 4) {
      const alphaSum = sums[i + 3] as number;
      out[i + 3] = clampByte((alphaSum / this.count) * 255);
      if (alphaSum === 0) continue;
      const scale = 1 / alphaSum;
      out[i] = this.fromWorking((sums[i] as number) * scale);
      out[i + 1] = this.fromWorking((sums[i + 1] as number) * scale);
      out[i + 2] = this.fromWorking((sums[i + 2] as number) * scale);
    }
    return { width: this.width, height: this.height, data: out };
  }
}
