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
} from "@hyperframes/engine";
import type { FileServerHandle } from "../../fileServer.js";
import type { ProducerLogger } from "../../../logger.js";
import {
  type HdrCompositeContext,
  type TransitionRange,
  compositeHdrFrame,
} from "../../hdrCompositor.js";
import { type HdrPerfCollector, addHdrTiming, timeHdrPhaseAsync } from "../hdrPerf.js";
import type { ProgressCallback, RenderJob } from "../../renderOrchestrator.js";
import { writeFileExclusiveSync } from "../shared.js";
import {
  type ShaderTransitionWorkerPool,
  createShaderTransitionWorkerPool,
} from "../../shaderTransitionWorkerPool.js";
import {
  type LayeredTransitionBuffers,
  captureTransitionFrameOnWorker,
  distributeLayeredHybridFrameRanges,
  ensureFrameWritten,
  partitionTransitionFrames,
  seekInjectAndQueryStacking,
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
    // hf#732 PR 5: K-deep ring of transition buffer-triples per worker. The
    // ring lets capture-N+1 proceed on the DOM worker while the shader-blend
    // pool is still working on frames N-K+1..N. Without the ring (PR 4), each
    // worker awaited its own blend before the next capture, capping the pool
    // at <=1 task per worker. With K=4, the pool sees up to min(N_workers * K,
    // poolSize) concurrent blends, which empirically pushes shader-render
    // wall time another ~10-20% past PR 4 alone.
    //
    // The ideal K is `blend_per_frame / capture_per_frame`. For 854x480
    // rgb48le with the more complex shaders this is ~910ms / ~175ms ≈ 5.
    // K=4 strikes a perf vs. memory balance. Override via
    // `HF_TRANSITION_RING_DEPTH` if a workload's blend/capture ratio is very
    // different (simpler shaders that blend in ~100ms tolerate K=1-2 without
    // perf loss).
    const DEFAULT_TRANSITION_RING_DEPTH = 4;
    const TRANSITION_RING_DEPTH = Math.max(
      1,
      Number(process.env.HF_TRANSITION_RING_DEPTH ?? String(DEFAULT_TRANSITION_RING_DEPTH)),
    );
    const workerTransitionRings: Array<LayeredTransitionBuffers[] | null> = sessions.map(() => {
      if (!hasTransitions) return null;
      const ring: LayeredTransitionBuffers[] = [];
      for (let k = 0; k < TRANSITION_RING_DEPTH; k++) {
        ring.push({
          bufferA: Buffer.alloc(bufSize),
          bufferB: Buffer.alloc(bufSize),
          output: Buffer.alloc(bufSize),
        });
      }
      return ring;
    });
    const workerRanges = distributeLayeredHybridFrameRanges(totalFrames, activeWorkerCount);
    let framesWritten = 0;
    const reorderBuffer = createFrameReorderBuffer(0, totalFrames);

    const writeEncoded = async (frameIdx: number, buf: Buffer): Promise<void> => {
      await reorderBuffer.waitForFrame(frameIdx);
      const writeStart = Date.now();
      ensureFrameWritten(await hdrEncoder.writeFrame(buf), frameIdx);
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
      const ring = workerTransitionRings[w];
      if (!session || !canvas || !range) return;
      // Per-ring-slot in-flight promise. When a slot is mid-blend, its
      // promise is non-null; before reusing the slot for a new capture we
      // await it so the buffer triple is free + the encoder has seen the
      // earlier frame (writeEncoded gates ordering via the reorder buffer).
      const ringInFlight: Array<Promise<void> | null> = ring ? ring.map(() => null) : [];
      let nextRingIdx = 0;
      for (let i = range.start; i < range.end; i++) {
        assertNotAborted();
        const time = (i * job.config.fps.den) / job.config.fps.num;
        const activeTransition = transitionFramesSet.has(i)
          ? transitionRanges.find((t) => i >= t.startFrame && i <= t.endFrame)
          : undefined;
        if (activeTransition && ring) {
          // Pick the next ring slot. If it's still in flight from an earlier
          // capture, await it to drain before reusing its buffer triple.
          const slot = nextRingIdx;
          nextRingIdx = (nextRingIdx + 1) % TRANSITION_RING_DEPTH;
          const prev = ringInFlight[slot];
          if (prev) await prev;
          const buffers = ring[slot];
          if (!buffers) continue;
          // CAPTURE on the DOM worker (this thread). Fills bufferA/bufferB
          // synchronously w.r.t. this loop — DOM work can't be pipelined
          // because the per-worker browser session is single-threaded.
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
          // BLEND + ENCODE without awaiting. The promise drains back into
          // `ringInFlight[slot]`; the next iteration that picks `slot`
          // awaits it. The encoder reorder buffer fences ordering so out-
          // of-order blend completion is fine.
          const frameIdx = i;
          // When the @hyperframes/shader-transitions composition omits the
          // shader on a transition entry, it requests a CSS crossfade. The
          // engine-side path uses applyFallbackTransition() on the page; the
          // producer's Node-side layered pipeline runs the equivalent here
          // by routing the blend through `crossfade`.
          const shaderName = activeTransition.shader;
          const dispatch: Promise<void> = (async () => {
            if (poolRef && shaderName) {
              const blendStart = Date.now();
              const result = await poolRef.run({
                shader: shaderName,
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
              const transitionFn: TransitionFn = shaderName
                ? (TRANSITIONS[shaderName] ?? crossfade)
                : crossfade;
              const blendStart = Date.now();
              transitionFn(
                buffers.bufferA,
                buffers.bufferB,
                buffers.output,
                width,
                height,
                progress,
              );
              addHdrTiming(hdrPerf, "transitionCompositeMs", blendStart);
            }
            await writeEncoded(frameIdx, buffers.output);
          })();
          // Catch on a separate handle so an unhandled-rejection can't fire
          // if no one awaits this slot before the worker exits. The error
          // is re-thrown on the next await (slot reuse OR end-of-task drain).
          ringInFlight[slot] = dispatch.catch((err: unknown) => {
            throw err instanceof Error ? err : new Error(String(err));
          });
        } else {
          const stackingInfo = await seekInjectAndQueryStacking(
            session.page,
            time,
            session.onBeforeCapture,
            nativeHdrIds,
            hdrPerf,
            "frameSeekMs",
            "frameInjectMs",
            "stackingQueryMs",
          );
          canvas.fill(0);
          // Rebind ctx to this worker's session for per-layer captures
          const wctx: HdrCompositeContext = { ...hdrCompositeCtx, domSession: session };
          await timeHdrPhaseAsync(hdrPerf, "normalCompositeMs", () =>
            compositeHdrFrame(wctx, canvas, time, stackingInfo, undefined, i),
          );
          if (debugDumpEnabled && debugDumpDir && i % 30 === 0) {
            writeFileExclusiveSync(
              join(debugDumpDir, `frame_${String(i).padStart(4, "0")}_final_rgb48le.bin`),
              canvas,
            );
          }
          await writeEncoded(i, canvas);
        }
      }
      // Drain any pipelined blends still in flight on this worker before
      // returning. If any rejected, the rejection bubbles here so
      // `Promise.all` over `workerTaskOf` sees the failure.
      for (const pending of ringInFlight) {
        if (pending) await pending;
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
