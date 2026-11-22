/**
 * HDR passthrough: skipping the video frame extraction it never reads.
 *
 * The passthrough composites the source file itself, so the frames Stage 2
 * decodes for its video are only read if the render ends up on another
 * route: the layered HDR composite after a fallback, or any route the render
 * takes once its HDR content is known. When the composition can take the
 * passthrough, Stage 2 leaves that video's frames deferred (probed metadata
 * and an exact frame count, no decode: the engine's `deferRangeExtraction`),
 * and they are extracted, the way a full extraction writes them, before the
 * first route that reads them. A completed passthrough never extracts them.
 */

import { isHttpUrl, qualifyVideoLayer } from "@hyperframes/engine";
import type { RenderConfig } from "../renderOrchestrator.js";
import type { CompositionMetadata } from "../render/shared.js";
import type { HdrPassthroughOutcome, HdrPassthroughResult } from "./types.js";

/** What is known before Stage 2 about whether the passthrough could run. */
export interface FrameDeferralGateInput {
  experimentalHdrPassthrough: boolean | undefined;
  hdrMode: RenderConfig["hdrMode"];
  outputFormat: string;
  needsAlpha: boolean;
  motionBlur: boolean;
  composition: Pick<CompositionMetadata, "videos" | "duration" | "gradedCanvas" | "masterFxChain">;
  /** Stage 2 already holds frames back for another reason (frame window, video layer passthrough). */
  framesHeldBackElsewhere: boolean;
}

/**
 * Whether Stage 2 should defer the frames of a native HDR video for the
 * passthrough. Only the gates of `checkPassthroughEligibility` that need
 * neither the probed media nor the page: opt-in, an HDR-capable render, mp4
 * without alpha or motion blur, no canvas grading or master effects, and
 * exactly one local video that qualifies as a layer. Stage 2 then defers only
 * when that video also probes as native HDR. A deferral the passthrough does
 * not use costs one later extraction of the same frames, never different
 * output.
 */
export function passthroughDefersFrameExtraction(input: FrameDeferralGateInput): boolean {
  if (input.experimentalHdrPassthrough !== true || input.framesHeldBackElsewhere) return false;
  if (input.hdrMode === "force-sdr") return false;
  if (input.outputFormat !== "mp4" || input.needsAlpha || input.motionBlur) return false;
  const { composition } = input;
  if (composition.gradedCanvas || composition.masterFxChain) return false;
  const qualified = qualifyVideoLayer(composition.videos, composition.duration);
  return qualified.qualifies && !isHttpUrl(qualified.video.src);
}

/** The frames Stage 2 deferred for the passthrough, extracted on first need. */
export interface DeferredPassthroughFrames {
  /** True until the deferred frames have been extracted; false when nothing was deferred. */
  readonly pending: boolean;
  /**
   * Extracts the deferred frames once. A no-op when nothing was deferred or
   * they are already extracted; concurrent callers share one extraction, and
   * a failed extraction rejects every caller.
   */
  ensureExtracted(): Promise<void>;
}

export function createDeferredPassthroughFrames(
  deferred: boolean,
  extract: () => Promise<void>,
): DeferredPassthroughFrames {
  let extraction: Promise<void> | undefined;
  let done = !deferred;
  return {
    get pending() {
      return !done;
    },
    ensureExtracted() {
      if (done) return Promise.resolve();
      extraction ??= extract().then(() => {
        done = true;
      });
      return extraction;
    },
  };
}

/**
 * The HDR layered capture with the passthrough in front of it: a completed
 * passthrough is the result and leaves deferred frames unextracted; a
 * fallback, or no attempt, extracts them before the layered stage runs.
 * Errors from `attempt` are already turned into fallbacks by
 * `attemptHdrPassthrough`; anything that still throws (an abort) propagates.
 */
export async function captureHdrWithPassthrough(args: {
  /** `undefined` when the passthrough is off for this render. */
  attempt: (() => Promise<HdrPassthroughOutcome>) | undefined;
  frames: DeferredPassthroughFrames;
  onFallback: () => void;
  layered: () => Promise<HdrPassthroughResult>;
}): Promise<HdrPassthroughResult> {
  if (args.attempt) {
    const outcome = await args.attempt();
    if (outcome.kind === "completed") return outcome.result;
    args.onFallback();
  }
  await args.frames.ensureExtracted();
  return args.layered();
}
