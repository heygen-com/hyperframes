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

/**
 * A resolved plan. Only `resolveMotionBlurPlan` produces one, so every field is already
 * clamped and the sample offsets are integers on a fixed sub-frame tick grid.
 */
export interface MotionBlurPlan {
  readonly blend: MotionBlurBlendSpace;
  /**
   * Sub-frame ticks per output frame. The seek grid is `fps * subFrameDivisions`, which
   * contains the output frame grid, so the frame-time instant never moves.
   */
  readonly subFrameDivisions: number;
  /** Tick offsets from the frame instant, ascending. Integers, so every host agrees. */
  readonly sampleTickOffsets: readonly number[];
}

export const MAX_SAMPLES_PER_FRAME = 64;

const DEFAULT_SAMPLES_PER_FRAME = 16;
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

  const samplesPerFrame = Math.min(
    MAX_SAMPLES_PER_FRAME,
    Math.max(1, Math.round(finiteOr(options.samplesPerFrame, DEFAULT_SAMPLES_PER_FRAME))),
  );
  const shutterAngle = finiteOr(options.shutterAngle, DEFAULT_SHUTTER_ANGLE);
  const shutterPhase = finiteOr(options.shutterPhase, DEFAULT_SHUTTER_PHASE);
  const blend: MotionBlurBlendSpace = options.blend === "linear" ? "linear" : "srgb";

  const windowStartFrames = shutterPhase / 360;
  const shutterFrames = shutterAngle / 360;
  const sampleTickOffsets: number[] = [];
  for (let k = 0; k < samplesPerFrame; k++) {
    const offsetFrames = windowStartFrames + ((k + 0.5) / samplesPerFrame) * shutterFrames;
    sampleTickOffsets.push(Math.round(offsetFrames * SUB_FRAME_DIVISIONS));
  }

  return { blend, subFrameDivisions: SUB_FRAME_DIVISIONS, sampleTickOffsets };
}

/**
 * Absolute seek times for one output frame, in ascending order.
 *
 * Built from integer ticks rather than by adding floats to `frameIndex / fps`, so the
 * page-side quantizer recovers the intended tick exactly on every host. Times before the
 * composition start clamp to 0, which is what After Effects does at the first frame.
 */
export function motionBlurSampleTimes(
  plan: MotionBlurPlan,
  frameIndex: number,
  fps: number,
): number[] {
  const grid = fps * plan.subFrameDivisions;
  const frameTicks = frameIndex * plan.subFrameDivisions;
  return plan.sampleTickOffsets.map((offset) => Math.max(0, frameTicks + offset) / grid);
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
  const first = Math.floor(
    frameIndex - 1 + Math.min(...plan.sampleTickOffsets) / plan.subFrameDivisions,
  );
  // A sample landing inside [F, F+1) reads content the frame set only pins down at both
  // ends, so the frame after the last one touched has to be static as well.
  const last =
    Math.floor(frameIndex + Math.max(...plan.sampleTickOffsets) / plan.subFrameDivisions) + 1;
  for (let frame = first; frame <= last; frame++) {
    if (!staticFrames.has(frame)) return false;
  }
  return true;
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
