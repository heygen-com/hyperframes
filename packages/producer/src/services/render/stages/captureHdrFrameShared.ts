/**
 * captureHdrFrameShared — shared helpers and types for the HDR
 * layered-composite frame loop (sequential + hybrid).
 *
 * Extracted from `captureHdrStage.ts` so the per-frame logic can live
 * under the project's 500-line file ceiling. The hybrid parallel path
 * (hf#732) adds a multi-DOM-worker dispatcher on top of the same per-
 * frame primitives the sequential loop uses, so the primitives are
 * centralized here.
 */

import { rmSync } from "node:fs";
import {
  type CaptureSession,
  type ElementStackingInfo,
  applyDomLayerMask,
  blitRgba8OverRgb48le,
  captureAlphaPng,
  decodePng,
  queryElementStacking,
  removeDomLayerMask,
} from "@hyperframes/engine";
import type { ProducerLogger } from "../../../logger.js";
import {
  type HdrCompositeContext,
  type HdrPerfCollector,
  type HdrVideoFrameSource,
  type TransitionRange,
  addHdrTiming,
  blitHdrImageLayer,
  blitHdrVideoLayer,
  closeHdrVideoFrameSource,
} from "../../renderOrchestrator.js";

// ─── Hybrid path gating + partitioning ─────────────────────────────────────

/**
 * Decide whether the hybrid parallel layered path is safe to use. Returns
 * `false` (legacy sequential path) when:
 *  - HDR content is present (HDR video raw-frame sources are fd-bound to a
 *    single worker; sharing across workers is out of scope for hf#732).
 *  - Every frame is inside a transition window (parallel workers buy
 *    nothing; sequential loop is fine).
 *  - workerCount <= 1.
 *
 * Exported so tests can pin the predicate without spinning up a render.
 */
export function shouldUseHybridLayeredPath(args: {
  hasHdrContent: boolean;
  transitionFramesCount: number;
  totalFrames: number;
  workerCount: number;
}): boolean {
  if (args.hasHdrContent) return false;
  if (args.workerCount <= 1) return false;
  if (args.totalFrames <= 0) return false;
  if (args.transitionFramesCount >= args.totalFrames) return false;
  return true;
}

/**
 * Distribute [0, totalFrames) across `workerCount` workers as roughly
 * equal contiguous slices. Transition-frame boundaries are NOT respected —
 * each worker runs both flavors of compositing on its own session.
 */
export function distributeLayeredHybridFrameRanges(
  totalFrames: number,
  workerCount: number,
): Array<{ start: number; end: number }> {
  const safeWorkers = Math.max(1, workerCount);
  const safeFrames = Math.max(0, totalFrames);
  const framesPerWorker = Math.max(1, Math.ceil(safeFrames / safeWorkers));
  const ranges: Array<{ start: number; end: number }> = [];
  for (let w = 0; w < safeWorkers; w++) {
    const start = Math.min(safeFrames, w * framesPerWorker);
    const end = Math.min(safeFrames, start + framesPerWorker);
    ranges.push({ start, end });
  }
  return ranges;
}

/** Build a Set of frame indices that fall inside any transition window. */
export function partitionTransitionFrames(
  transitionRanges: ReadonlyArray<Pick<TransitionRange, "startFrame" | "endFrame">>,
  totalFrames: number,
): Set<number> {
  const frames = new Set<number>();
  if (totalFrames <= 0) return frames;
  for (const range of transitionRanges) {
    const start = Math.max(0, range.startFrame);
    const end = Math.min(totalFrames - 1, range.endFrame);
    for (let i = start; i <= end; i++) frames.add(i);
  }
  return frames;
}

// ─── Types ─────────────────────────────────────────────────────────────────

export interface LayeredTransitionBuffers {
  bufferA: Buffer;
  bufferB: Buffer;
  output: Buffer;
}

// ─── Per-scene capture (shared by sequential transition + hybrid worker) ──

export interface CaptureSceneArgs {
  session: CaptureSession;
  sceneBuf: Buffer;
  sceneIds: Set<string>;
  stackingInfo: ElementStackingInfo[];
  time: number;
  width: number;
  height: number;
  nativeHdrIds: Set<string>;
  nativeHdrImageIds: Set<string>;
  beforeCaptureHook: CaptureSession["onBeforeCapture"];
  hdrCompositeCtx: HdrCompositeContext;
  compositeTransfer: "srgb" | "pq" | "hlg";
  hdrTargetTransfer: "pq" | "hlg" | undefined;
  hdrPerf: HdrPerfCollector | undefined;
  log: ProducerLogger;
  frameIdx: number;
}

export async function captureSceneIntoBuffer(a: CaptureSceneArgs): Promise<void> {
  const {
    session,
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
    frameIdx,
  } = a;
  let timingStart = Date.now();
  await session.page.evaluate((t: number) => {
    if (window.__hf && typeof window.__hf.seek === "function") window.__hf.seek(t);
  }, time);
  addHdrTiming(hdrPerf, "domLayerSeekMs", timingStart);
  if (beforeCaptureHook) {
    timingStart = Date.now();
    await beforeCaptureHook(session.page, time);
    addHdrTiming(hdrPerf, "domLayerInjectMs", timingStart);
  }
  for (const el of stackingInfo) {
    if (!el.isHdr || !sceneIds.has(el.id)) continue;
    if (nativeHdrImageIds.has(el.id)) {
      blitHdrImageLayer(
        sceneBuf,
        el,
        hdrCompositeCtx.hdrImageBuffers,
        hdrCompositeCtx.hdrImageTransferCache,
        width,
        height,
        log,
        hdrCompositeCtx.imageTransfers.get(el.id),
        hdrTargetTransfer,
        hdrPerf,
      );
    } else {
      blitHdrVideoLayer(
        sceneBuf,
        el,
        time,
        hdrCompositeCtx.fps,
        hdrCompositeCtx.hdrVideoFrameSources,
        hdrCompositeCtx.hdrVideoStartTimes,
        width,
        height,
        log,
        hdrCompositeCtx.videoTransfers.get(el.id),
        hdrTargetTransfer,
        hdrPerf,
      );
    }
  }
  const showIds = Array.from(sceneIds);
  const hideIds = stackingInfo
    .map((e) => e.id)
    .filter((id) => !sceneIds.has(id) || nativeHdrIds.has(id));
  if (hdrPerf) hdrPerf.domLayerCaptures += 1;
  timingStart = Date.now();
  await applyDomLayerMask(session.page, showIds, hideIds);
  addHdrTiming(hdrPerf, "domMaskApplyMs", timingStart);
  timingStart = Date.now();
  const domPng = await captureAlphaPng(session.page, width, height);
  addHdrTiming(hdrPerf, "domScreenshotMs", timingStart);
  timingStart = Date.now();
  await removeDomLayerMask(session.page, hideIds);
  addHdrTiming(hdrPerf, "domMaskRemoveMs", timingStart);
  try {
    timingStart = Date.now();
    const { data: domRgba } = decodePng(domPng);
    addHdrTiming(hdrPerf, "domPngDecodeMs", timingStart);
    timingStart = Date.now();
    blitRgba8OverRgb48le(domRgba, sceneBuf, width, height, compositeTransfer);
    addHdrTiming(hdrPerf, "domBlitMs", timingStart);
  } catch (err) {
    log.warn("DOM layer decode/blit failed; skipping overlay for transition scene", {
      frameIndex: frameIdx,
      sceneIds: Array.from(sceneIds),
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ─── Per-frame transition capture (hybrid worker path) ─────────────────────

export interface CaptureTransitionOnWorkerArgs {
  session: CaptureSession;
  frameIdx: number;
  time: number;
  transition: TransitionRange;
  buffers: LayeredTransitionBuffers;
  nativeHdrIds: Set<string>;
  nativeHdrImageIds: Set<string>;
  sceneElements: Record<string, string[]>;
  hdrCompositeCtx: HdrCompositeContext;
  width: number;
  height: number;
  compositeTransfer: "srgb" | "pq" | "hlg";
  hdrTargetTransfer: "pq" | "hlg" | undefined;
  hdrPerf: HdrPerfCollector | undefined;
  log: ProducerLogger;
}

export async function captureTransitionFrameOnWorker(
  a: CaptureTransitionOnWorkerArgs,
): Promise<void> {
  const {
    session,
    frameIdx,
    time,
    transition,
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
  } = a;
  const beforeCaptureHook = session.onBeforeCapture;
  if (hdrPerf) {
    hdrPerf.frames += 1;
    hdrPerf.transitionFrames += 1;
  }
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
  const sceneAIds = new Set(sceneElements[transition.fromScene] ?? []);
  const sceneBIds = new Set(sceneElements[transition.toScene] ?? []);
  buffers.bufferA.fill(0);
  buffers.bufferB.fill(0);
  for (const [sceneBuf, sceneIds] of [
    [buffers.bufferA, sceneAIds],
    [buffers.bufferB, sceneBIds],
  ] as const) {
    await captureSceneIntoBuffer({
      session,
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
      frameIdx,
    });
  }
}

// ─── HDR video raw-frame cleanup (sequential path only) ────────────────────

export function cleanupEndedHdrVideos(args: {
  time: number;
  activeTransition: TransitionRange | undefined;
  hdrVideoEndTimes: Map<string, number>;
  cleanedUpVideos: Set<string>;
  hdrVideoFrameSources: Map<string, HdrVideoFrameSource>;
  sceneElements: Record<string, string[]>;
  log: ProducerLogger;
}): void {
  if (process.env.KEEP_TEMP === "1") return;
  const {
    time,
    activeTransition,
    hdrVideoEndTimes,
    cleanedUpVideos,
    hdrVideoFrameSources,
    sceneElements,
    log,
  } = args;
  for (const [videoId, endTime] of hdrVideoEndTimes) {
    if (time > endTime && !cleanedUpVideos.has(videoId)) {
      const stillNeeded =
        activeTransition &&
        (sceneElements[activeTransition.fromScene]?.includes(videoId) ||
          sceneElements[activeTransition.toScene]?.includes(videoId));
      if (!stillNeeded) {
        const frameSource = hdrVideoFrameSources.get(videoId);
        if (frameSource) {
          closeHdrVideoFrameSource(frameSource, log);
          try {
            rmSync(frameSource.dir, { recursive: true, force: true });
          } catch (err) {
            log.warn("Failed to clean up HDR raw frame directory", {
              videoId,
              frameDir: frameSource.dir,
              rawPath: frameSource.rawPath,
              error: err instanceof Error ? err.message : String(err),
            });
          }
          hdrVideoFrameSources.delete(videoId);
        }
        cleanedUpVideos.add(videoId);
      }
    }
  }
}
