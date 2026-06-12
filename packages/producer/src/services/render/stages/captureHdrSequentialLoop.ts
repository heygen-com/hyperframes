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
  queryElementStacking,
} from "@hyperframes/engine";
import type { ProducerLogger } from "../../../logger.js";
import {
  type HdrCompositeContext,
  type HdrPerfCollector,
  type ProgressCallback,
  type RenderJob,
  type TransitionRange,
  addHdrTiming,
  compositeHdrFrame,
} from "../../renderOrchestrator.js";
import { writeFileExclusiveSync } from "../shared.js";
import {
  captureSceneIntoBuffer,
  cleanupEndedHdrVideos,
  ensureFrameWritten,
  type LayeredTransitionBuffers,
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
  hdrVideoFrameSources: Map<string, import("../../renderOrchestrator.js").HdrVideoFrameSource>;
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

    let timingStart = Date.now();
    await domSession.page.evaluate((t: number) => {
      if (window.__hf && typeof window.__hf.seek === "function") window.__hf.seek(t);
    }, time);
    addHdrTiming(hdrPerf, "frameSeekMs", timingStart);

    if (beforeCaptureHook) {
      timingStart = Date.now();
      await beforeCaptureHook(domSession.page, time);
      addHdrTiming(hdrPerf, "frameInjectMs", timingStart);
    }
    timingStart = Date.now();
    const stackingInfo = await queryElementStacking(domSession.page, nativeHdrIds);
    addHdrTiming(hdrPerf, "stackingQueryMs", timingStart);
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
      timingStart = Date.now();
      transitionBuffers.bufferA.fill(0);
      transitionBuffers.bufferB.fill(0);
      addHdrTiming(hdrPerf, "canvasClearMs", timingStart);

      for (const [sceneBuf, sceneIds] of [
        [transitionBuffers.bufferA, sceneAIds],
        [transitionBuffers.bufferB, sceneBIds],
      ] as const) {
        assertNotAborted();
        await captureSceneIntoBuffer({
          session: domSession,
          sceneBuf: sceneBuf as Buffer,
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
      timingStart = Date.now();
      ensureFrameWritten(await hdrEncoder.writeFrame(transitionBuffers.output), i);
      addHdrTiming(hdrPerf, "encoderWriteMs", timingStart);
    } else {
      if (hdrPerf) hdrPerf.normalFrames += 1;
      timingStart = Date.now();
      normalCanvas.fill(0);
      addHdrTiming(hdrPerf, "canvasClearMs", timingStart);
      timingStart = Date.now();
      await compositeHdrFrame(hdrCompositeCtx, normalCanvas, time, stackingInfo, undefined, i);
      addHdrTiming(hdrPerf, "normalCompositeMs", timingStart);
      if (debugDumpEnabled && debugDumpDir && i % 30 === 0) {
        writeFileExclusiveSync(
          join(debugDumpDir, `frame_${String(i).padStart(4, "0")}_final_rgb48le.bin`),
          normalCanvas,
        );
      }
      timingStart = Date.now();
      ensureFrameWritten(await hdrEncoder.writeFrame(normalCanvas), i);
      addHdrTiming(hdrPerf, "encoderWriteMs", timingStart);
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
