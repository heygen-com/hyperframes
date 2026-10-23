import type { BeforeCaptureHook } from "@hyperframes/engine";
import { waitForPendingSeekCompletion } from "@hyperframes/engine";
import type { ChunkFrameRange } from "./renderChunk.js";
import { readLayeredFrame } from "./layeredFrame.js";

import type { LayeredFallbackReason, LayeredFrame } from "./layeredFrameState.js";

export type LayeredChunkDecision =
  | { kind: "eligible"; frames: number; videoCount: number }
  | { kind: "fallback"; reason: LayeredFallbackReason; frameIndex: number | null };

export function createLayeredChunkClassifier({ startFrame, endFrame }: ChunkFrameRange) {
  if (
    !Number.isSafeInteger(startFrame) ||
    !Number.isSafeInteger(endFrame) ||
    startFrame < 0 ||
    endFrame <= startFrame
  ) {
    throw new Error("Invalid layered chunk frame range");
  }
  const observed = new Set<number>();
  let baseline: Extract<LayeredFrame, { kind: "candidate" }> | undefined;
  let failure: Extract<LayeredChunkDecision, { kind: "fallback" }> | undefined;

  function recordFailure(frameIndex: number, reason: LayeredFallbackReason): void {
    if (!failure || failure.frameIndex === null || frameIndex < failure.frameIndex) {
      failure = { kind: "fallback", reason, frameIndex };
    }
  }
  function inRange(frameIndex: number): boolean {
    return Number.isInteger(frameIndex) && frameIndex >= startFrame && frameIndex < endFrame;
  }

  return {
    excludeNoVideo(): void {
      failure = { kind: "fallback", reason: "no_video", frameIndex: null };
    },
    observe(frameIndex: number, frame: LayeredFrame): void {
      if (!inRange(frameIndex)) return;
      observed.add(frameIndex);
      if (frame.kind === "fallback") {
        recordFailure(frameIndex, frame.reason);
      } else if (baseline && baseline.signature !== frame.signature) {
        failure ??= { kind: "fallback", reason: "changing_video_layout", frameIndex };
      } else {
        baseline ??= frame;
      }
    },
    decision(): LayeredChunkDecision {
      if (failure) return failure;
      if (!baseline || observed.size !== endFrame - startFrame) {
        return { kind: "fallback", reason: "incomplete_frames", frameIndex: null };
      }
      return { kind: "eligible", frames: observed.size, videoCount: baseline.videoCount };
    },
  };
}

export function createLayeredChunkObserver(range: ChunkFrameRange, fps: number) {
  const { startFrame, endFrame } = range;
  const classifier = createLayeredChunkClassifier({ startFrame, endFrame });
  if (!Number.isFinite(fps) || fps <= 0) throw new Error("Invalid layered chunk FPS");
  return {
    wrap(inject: BeforeCaptureHook | null): BeforeCaptureHook | null {
      if (inject === null) {
        classifier.excludeNoVideo();
        return null;
      }
      return async (page, time, heldVideoTime) => {
        await inject(page, time, heldVideoTime);
        const frameIndex = Math.round(time * fps);
        const decision = classifier.decision();
        if (
          frameIndex < startFrame ||
          frameIndex >= endFrame ||
          (decision.kind === "fallback" && decision.reason !== "incomplete_frames")
        )
          return;
        if (Math.abs(time * fps - frameIndex) > 1e-6) {
          classifier.observe(frameIndex, { kind: "fallback", reason: "unsupported_sampling" });
          return;
        }
        await waitForPendingSeekCompletion(page);
        let frame: LayeredFrame;
        try {
          frame = await readLayeredFrame(page);
        } catch {
          frame = { kind: "fallback", reason: "observation_error" };
        }
        classifier.observe(frameIndex, frame);
      };
    },
    decision: classifier.decision,
  };
}
