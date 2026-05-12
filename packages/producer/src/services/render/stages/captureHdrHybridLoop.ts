/**
 * captureHdrHybridLoop — the hf#732 hybrid parallel layered path.
 *
 * Spreads per-frame DOM capture work across N DOM worker sessions (one
 * Chrome session per worker) and offloads the per-pixel shader-blend onto
 * a `worker_threads` pool. The encoder is fed via a frame-reorder buffer
 * so out-of-order worker completions still hit the muxer in ascending
 * index order.
 *
 * Restrictions enforced by `shouldUseHybridLayeredPath`:
 *  - SDR only (HDR raw-frame sources are fd-bound to one worker).
 *  - workerCount >= 2.
 *  - Not every frame inside a transition window.
 *
 * Pool teardown is guaranteed in the outer `finally` regardless of which
 * path threw — see `runHybridLayeredFrameLoop`. The shader-blend pool is
 * spawned lazily (only when the composition has transitions); the DOM
 * worker sessions are always spawned.
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  type CaptureOptions,
  type CaptureSession,
  type EngineConfig,
  type StreamingEncoder,
  type TransitionFn,
  TRANSITIONS,
  closeCaptureSession,
  createCaptureSession,
  createFrameReorderBuffer,
  crossfade,
  initTransparentBackground,
  initializeSession,
  queryElementStacking,
} from "@hyperframes/engine";
import type { FileServerHandle } from "../../fileServer.js";
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
import {
  type ShaderTransitionWorkerPool,
  createShaderTransitionWorkerPool,
} from "../../shaderTransitionWorkerPool.js";
import {
  type LayeredTransitionBuffers,
  captureTransitionFrameOnWorker,
  distributeLayeredHybridFrameRanges,
  partitionTransitionFrames,
} from "./captureHdrFrameShared.js";
import { updateJobStatus } from "../shared.js";

export interface HybridLoopInput {
  job: RenderJob;
  cfg: EngineConfig;
  log: ProducerLogger;
  framesDir: string;
  width: number;
  height: number;
  totalFrames: number;
  nativeHdrIds: Set<string>;
  nativeHdrImageIds: Set<string>;
  hdrCompositeCtx: HdrCompositeContext;
  hdrPerf: HdrPerfCollector | undefined;
  hdrEncoder: StreamingEncoder;
  domSession: CaptureSession;
  fileServer: FileServerHandle;
  buildCaptureOptions: () => CaptureOptions;
  createRenderVideoFrameInjector: () => Parameters<typeof createCaptureSession>[3];
  transitionRanges: TransitionRange[];
  sceneElements: Record<string, string[]>;
  compositeTransfer: "srgb" | "pq" | "hlg";
  hdrTargetTransfer: "pq" | "hlg" | undefined;
  workerCount: number;
  debugDumpEnabled: boolean;
  debugDumpDir: string | null;
  assertNotAborted: () => void;
  onProgress?: ProgressCallback;
}

export async function runHybridLayeredFrameLoop(input: HybridLoopInput): Promise<void> {
  const {
    job,
    cfg,
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
    fileServer,
    buildCaptureOptions,
    createRenderVideoFrameInjector,
    transitionRanges,
    sceneElements,
    compositeTransfer,
    hdrTargetTransfer,
    workerCount,
    debugDumpEnabled,
    debugDumpDir,
    assertNotAborted,
    onProgress,
  } = input;
  const transitionFramesSet = partitionTransitionFrames(transitionRanges, totalFrames);
  const hasTransitions = transitionRanges.length > 0;
  const bufSize = width * height * 6;

  const workerSessions: CaptureSession[] = [];
  let shaderPool: ShaderTransitionWorkerPool | null = null;
  try {
    for (let w = 0; w < workerCount - 1; w++) {
      const s = await createCaptureSession(
        fileServer.url,
        input.framesDir,
        buildCaptureOptions(),
        createRenderVideoFrameInjector(),
        cfg,
      );
      await initializeSession(s);
      await initTransparentBackground(s.page);
      workerSessions.push(s);
    }
    const sessions: CaptureSession[] = [domSession, ...workerSessions];
    const activeWorkerCount = sessions.length;
    if (hasTransitions) {
      try {
        shaderPool = await createShaderTransitionWorkerPool({ size: activeWorkerCount, log });
      } catch (err) {
        log.warn(
          "[Render] Failed to spawn shader-blend worker pool; falling back to inline shader blend",
          { error: err instanceof Error ? err.message : String(err) },
        );
        shaderPool = null;
      }
    }

    const workerCanvases: Buffer[] = sessions.map(() => Buffer.alloc(bufSize));
    const workerTransitionBuffers: Array<LayeredTransitionBuffers | null> = sessions.map(() =>
      hasTransitions
        ? {
            bufferA: Buffer.alloc(bufSize),
            bufferB: Buffer.alloc(bufSize),
            output: Buffer.alloc(bufSize),
          }
        : null,
    );
    const workerRanges = distributeLayeredHybridFrameRanges(totalFrames, activeWorkerCount);
    let framesWritten = 0;
    const reorderBuffer = createFrameReorderBuffer(0, totalFrames);

    const writeEncoded = async (frameIdx: number, buf: Buffer): Promise<void> => {
      await reorderBuffer.waitForFrame(frameIdx);
      const writeStart = Date.now();
      hdrEncoder.writeFrame(buf);
      addHdrTiming(hdrPerf, "encoderWriteMs", writeStart);
      reorderBuffer.advanceTo(frameIdx + 1);
      framesWritten += 1;
      job.framesRendered = framesWritten;
      if (framesWritten % 10 === 0 || framesWritten === totalFrames) {
        const frameProgress = framesWritten / totalFrames;
        updateJobStatus(
          job,
          "rendering",
          `Layered composite frame ${framesWritten}/${job.totalFrames}`,
          Math.round(25 + frameProgress * 55),
          onProgress,
        );
      }
    };
    const poolRef = shaderPool;

    const workerTaskOf = async (w: number): Promise<void> => {
      const session = sessions[w];
      const canvas = workerCanvases[w];
      const range = workerRanges[w];
      const buffers = workerTransitionBuffers[w];
      if (!session || !canvas || !range) return;
      for (let i = range.start; i < range.end; i++) {
        assertNotAborted();
        const time = (i * job.config.fps.den) / job.config.fps.num;
        const activeTransition = transitionFramesSet.has(i)
          ? transitionRanges.find((t) => i >= t.startFrame && i <= t.endFrame)
          : undefined;
        if (activeTransition && buffers) {
          await captureTransitionFrameOnWorker({
            session,
            frameIdx: i,
            time,
            transition: activeTransition,
            buffers,
            nativeHdrIds,
            nativeHdrImageIds,
            sceneElements,
            hdrCompositeCtx,
            width,
            height,
            compositeTransfer,
            hdrTargetTransfer,
            hdrPerf,
            log,
          });
          const progress =
            activeTransition.endFrame === activeTransition.startFrame
              ? 1
              : (i - activeTransition.startFrame) /
                (activeTransition.endFrame - activeTransition.startFrame);
          if (poolRef) {
            const blendStart = Date.now();
            const result = await poolRef.run({
              shader: activeTransition.shader,
              bufferA: buffers.bufferA,
              bufferB: buffers.bufferB,
              output: buffers.output,
              width,
              height,
              progress,
            });
            buffers.bufferA = result.bufferA;
            buffers.bufferB = result.bufferB;
            buffers.output = result.output;
            addHdrTiming(hdrPerf, "transitionCompositeMs", blendStart);
          } else {
            const transitionFn: TransitionFn = TRANSITIONS[activeTransition.shader] ?? crossfade;
            const blendStart = Date.now();
            transitionFn(buffers.bufferA, buffers.bufferB, buffers.output, width, height, progress);
            addHdrTiming(hdrPerf, "transitionCompositeMs", blendStart);
          }
          await writeEncoded(i, buffers.output);
        } else {
          const beforeCaptureHook = session.onBeforeCapture;
          let timingStart = Date.now();
          await session.page.evaluate((t: number) => {
            if (window.__hf && typeof window.__hf.seek === "function") window.__hf.seek(t);
          }, time);
          addHdrTiming(hdrPerf, "frameSeekMs", timingStart);
          if (beforeCaptureHook) {
            timingStart = Date.now();
            await beforeCaptureHook(session.page, time);
            addHdrTiming(hdrPerf, "frameInjectMs", timingStart);
          }
          timingStart = Date.now();
          const stackingInfo = await queryElementStacking(session.page, nativeHdrIds);
          addHdrTiming(hdrPerf, "stackingQueryMs", timingStart);
          canvas.fill(0);
          // Rebind ctx to this worker's session for per-layer captures
          const wctx: HdrCompositeContext = { ...hdrCompositeCtx, domSession: session };
          timingStart = Date.now();
          await compositeHdrFrame(wctx, canvas, time, stackingInfo, undefined, i);
          addHdrTiming(hdrPerf, "normalCompositeMs", timingStart);
          if (debugDumpEnabled && debugDumpDir && i % 30 === 0) {
            writeFileSync(
              join(debugDumpDir, `frame_${String(i).padStart(4, "0")}_final_rgb48le.bin`),
              canvas,
            );
          }
          await writeEncoded(i, canvas);
        }
      }
    };
    await Promise.all(sessions.map((_, w) => workerTaskOf(w)));
    await reorderBuffer.waitForAllDone();
  } finally {
    for (const s of workerSessions) {
      await closeCaptureSession(s).catch((err) => {
        log.warn("Hybrid worker session close failed", {
          err: err instanceof Error ? err.message : String(err),
        });
      });
    }
    if (shaderPool) {
      await shaderPool.terminate().catch((err) => {
        log.warn("Shader-blend worker pool terminate failed", {
          err: err instanceof Error ? err.message : String(err),
        });
      });
    }
  }
}
