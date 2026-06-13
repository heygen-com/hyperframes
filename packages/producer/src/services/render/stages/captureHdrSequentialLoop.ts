/**
 * captureHdrSequentialLoop — the legacy sequential HDR / shader-transition
 * frame loop. Single DOM session, single-threaded per-frame work. Used by:
 *
 *  - HDR renders (HDR video raw-frame sources are fd-bound to one worker)
 *  - single-worker SDR renders
 *  - the all-transition edge case (parallel workers buy nothing there)
 *
 * Sister of `captureHdrHybridLoop.ts`. Both consume the same per-frame
 * primitives from `captureHdrFrameShared.ts` so behavior parity is enforced
 * by reusing the helpers rather than by careful comment-keeping.
 */

import { join } from "node:path";
import {
  type CaptureSession,
  type StreamingEncoder,
  type TransitionFn,
  TRANSITIONS,
  crossfade,
} from "@hyperframes/engine";
import type { ProducerLogger } from "../../../logger.js";
import {
  type HdrCompositeContext,
  type TransitionRange,
  compositeHdrFrame,
} from "../../hdrCompositor.js";
import {
  type HdrPerfCollector,
  addHdrTiming,
  timeHdrPhase,
  timeHdrPhaseAsync,
} from "../hdrPerf.js";
import type { ProgressCallback, RenderJob } from "../../renderOrchestrator.js";
import { writeFileExclusiveSync } from "../shared.js";
import {
  captureSceneIntoBuffer,
  cleanupEndedHdrVideos,
  ensureFrameWritten,
  type LayeredTransitionBuffers,
  seekInjectAndQueryStacking,
} from "./captureHdrFrameShared.js";
import { updateJobStatus } from "../shared.js";

export interface SequentialLoopInput {
  job: RenderJob;
  log: ProducerLogger;
  width: number;
  height: number;
  totalFrames: number;
  nativeHdrIds: Set<string>;
  nativeHdrImageIds: Set<string>;
  hdrCompositeCtx: HdrCompositeContext;
  hdrPerf: HdrPerfCollector | undefined;
  hdrEncoder: StreamingEncoder;
  domSession: CaptureSession;
  transitionRanges: TransitionRange[];
  sceneElements: Record<string, string[]>;
  compositeTransfer: "srgb" | "pq" | "hlg";
  hdrTargetTransfer: "pq" | "hlg" | undefined;
  hdrVideoEndTimes: Map<string, number>;
  cleanedUpVideos: Set<string>;
  hdrVideoFrameSources: Map<string, import("../../hdrCompositor.js").HdrVideoFrameSource>;
  debugDumpEnabled: boolean;
  debugDumpDir: string | null;
  assertNotAborted: () => void;
  onProgress?: ProgressCallback;
}

export async function runSequentialLayeredFrameLoop(input: SequentialLoopInput): Promise<void> {
  const {
    job,
    log,
    width,
    height,
    totalFrames,
    nativeHdrIds,
    nativeHdrImageIds,
    hdrCompositeCtx,
    hdrPerf,
    hdrEncoder,
    domSession,
    transitionRanges,
    sceneElements,
    compositeTransfer,
    hdrTargetTransfer,
    hdrVideoEndTimes,
    cleanedUpVideos,
    hdrVideoFrameSources,
    debugDumpEnabled,
    debugDumpDir,
    assertNotAborted,
    onProgress,
  } = input;
  const beforeCaptureHook = domSession.onBeforeCapture;
  const bufSize = width * height * 6;
  const hasTransitions = transitionRanges.length > 0;
  const transitionBuffers: LayeredTransitionBuffers | null = hasTransitions
    ? {
        bufferA: Buffer.alloc(bufSize),
        bufferB: Buffer.alloc(bufSize),
        output: Buffer.alloc(bufSize),
      }
    : null;
  const normalCanvas = Buffer.alloc(bufSize);

  for (let i = 0; i < totalFrames; i++) {
    assertNotAborted();
    const time = (i * job.config.fps.den) / job.config.fps.num;
    if (hdrPerf) hdrPerf.frames += 1;

    const stackingInfo = await seekInjectAndQueryStacking(
      domSession.page,
      time,
      beforeCaptureHook,
      nativeHdrIds,
      hdrPerf,
      "frameSeekMs",
      "frameInjectMs",
      "stackingQueryMs",
    );
    const activeTransition = transitionRanges.find((t) => i >= t.startFrame && i <= t.endFrame);

    if (i % 30 === 0 && (log.isLevelEnabled?.("debug") ?? true)) {
      const hdrEl = stackingInfo.find((e) => e.isHdr);
      log.debug("[Render] HDR layer composite frame", {
        frame: i,
        time: time.toFixed(2),
        hdrElement: hdrEl ? { z: hdrEl.zIndex, visible: hdrEl.visible, width: hdrEl.width } : null,
        stackingCount: stackingInfo.length,
        activeTransition: activeTransition?.shader,
      });
    }

    if (activeTransition && transitionBuffers) {
      if (hdrPerf) hdrPerf.transitionFrames += 1;
      const transitionTimingStart = Date.now();
      const progress =
        activeTransition.endFrame === activeTransition.startFrame
          ? 1
          : (i - activeTransition.startFrame) /
            (activeTransition.endFrame - activeTransition.startFrame);
      const sceneAIds = new Set(sceneElements[activeTransition.fromScene] ?? []);
      const sceneBIds = new Set(sceneElements[activeTransition.toScene] ?? []);
      timeHdrPhase(hdrPerf, "canvasClearMs", () => {
        transitionBuffers.bufferA.fill(0);
        transitionBuffers.bufferB.fill(0);
      });

      const sceneCaptures: [Buffer, Set<string>][] = [
        [transitionBuffers.bufferA, sceneAIds],
        [transitionBuffers.bufferB, sceneBIds],
      ];
      for (const [sceneBuf, sceneIds] of sceneCaptures) {
        assertNotAborted();
        await captureSceneIntoBuffer({
          session: domSession,
          sceneBuf,
          sceneIds,
          stackingInfo,
          time,
          width,
          height,
          nativeHdrIds,
          nativeHdrImageIds,
          beforeCaptureHook,
          hdrCompositeCtx,
          compositeTransfer,
          hdrTargetTransfer,
          hdrPerf,
          log,
          frameIdx: i,
        });
      }

      // CSS-crossfade transitions (shader omitted in the composition) take
      // the same Node-side blend path — `crossfade` is the engine's
      // canonical opacity blend, equivalent to applyFallbackTransition().
      const shaderName = activeTransition.shader;
      const transitionFn: TransitionFn = shaderName
        ? (TRANSITIONS[shaderName] ?? crossfade)
        : crossfade;
      transitionFn(
        transitionBuffers.bufferA,
        transitionBuffers.bufferB,
        transitionBuffers.output,
        width,
        height,
        progress,
      );
      addHdrTiming(hdrPerf, "transitionCompositeMs", transitionTimingStart);
      await timeHdrPhaseAsync(hdrPerf, "encoderWriteMs", async () =>
        ensureFrameWritten(await hdrEncoder.writeFrame(transitionBuffers.output), i),
      );
    } else {
      if (hdrPerf) hdrPerf.normalFrames += 1;
      timeHdrPhase(hdrPerf, "canvasClearMs", () => normalCanvas.fill(0));
      await timeHdrPhaseAsync(hdrPerf, "normalCompositeMs", () =>
        compositeHdrFrame(hdrCompositeCtx, normalCanvas, time, stackingInfo, undefined, i),
      );
      if (debugDumpEnabled && debugDumpDir && i % 30 === 0) {
        writeFileExclusiveSync(
          join(debugDumpDir, `frame_${String(i).padStart(4, "0")}_final_rgb48le.bin`),
          normalCanvas,
        );
      }
      await timeHdrPhaseAsync(hdrPerf, "encoderWriteMs", async () =>
        ensureFrameWritten(await hdrEncoder.writeFrame(normalCanvas), i),
      );
    }

    cleanupEndedHdrVideos({
      time,
      activeTransition,
      hdrVideoEndTimes,
      cleanedUpVideos,
      hdrVideoFrameSources,
      sceneElements,
      log,
    });
    job.framesRendered = i + 1;
    if ((i + 1) % 10 === 0 || i + 1 === totalFrames) {
      const frameProgress = (i + 1) / totalFrames;
      updateJobStatus(
        job,
        "rendering",
        `Layered composite frame ${i + 1}/${job.totalFrames}`,
        Math.round(25 + frameProgress * 55),
        onProgress,
      );
    }
  }
}
