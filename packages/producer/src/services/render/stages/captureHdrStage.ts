/**
 * captureHdrStage — Z-ordered HDR / shader-transition layered composite.
 *
 * The most complex capture path:
 *   - Spawns a dedicated `domSession` for transparent-background screenshots.
 *   - Spawns an `hdrEncoder` (`spawnStreamingEncoder` with
 *     `rawInputFormat: "rgb48le"`) accepting pre-composited HDR frames.
 *   - Opens raw HDR video frame files (`hdrVideoFrameSources`) and reads
 *     them per-frame for native-HDR video layers.
 *   - Decodes 16-bit HDR PNGs once and blits them as image layers.
 *   - Queries Chrome z-order at layout-change boundaries and groups
 *     elements into DOM / HDR video / HDR image layers.
 *   - Dispatches per-frame work to either the sequential layered loop
 *     (HDR-content, single-worker, all-transition edge cases) or the
 *     hybrid parallel loop introduced in hf#732 (multi-worker SDR with
 *     `worker_threads`-pool shader blend).
 *
 * Cleanup invariants the design doc explicitly flags as risky —
 * preserved verbatim from the in-process renderer:
 *   - `hdrEncoderClosed` / `domSessionClosed` flags gate defensive-close
 *     paths so they don't run twice when the success path already closed.
 *   - `hdrVideoFrameSources` is drained + cleared in the outer `finally`
 *     regardless of how the body exits.
 *   - The layered path unconditionally captures in screenshot mode
 *     because `captureAlphaPng` hangs under `--enable-begin-frame-control`.
 *     Previously the stage mutated `cfg.forceScreenshot = true` directly;
 *     the value is now derived into a local `hdrCfg` so the caller-owned
 *     `cfg` survives the stage unchanged. The sequencer passes an immutable
 *     `hdr_layered` plan whose construction guarantees screenshot mode.
 *
 * Resource setup (HDR video extraction, image decode, dim probing) lives
 * in `captureHdrResources.ts`; per-frame work lives in
 * `captureHdrSequentialLoop.ts` and `captureHdrHybridLoop.ts`. Shared
 * primitives across both loops live in `captureHdrFrameShared.ts`.
 */

import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  type BeforeCaptureHook,
  type CaptureOptions,
  type CaptureWarning,
  type EngineConfig,
  type HdrTransfer,
  type StreamingEncoder,
  closeCaptureSession,
  createCaptureSession,
  getEncoderPreset,
  initTransparentBackground,
  initializeSession,
  spawnStreamingEncoder,
} from "@hyperframes/engine";
import { fpsToNumber } from "@hyperframes/core";
import type { FileServerHandle } from "../../fileServer.js";
import type { ProducerLogger } from "../../../logger.js";
import { createHdrImageTransferCache } from "../../hdrImageTransferCache.js";
import {
  type HdrCompositeContext,
  type HdrTransitionMeta,
  type HdrVideoFrameSource,
  type TransitionRange,
  closeHdrVideoFrameSource,
  resolveCompositeTransfer,
} from "../../hdrCompositor.js";
import { type HdrPerfCollector, createHdrPerfCollector } from "../hdrPerf.js";
import type { HdrDiagnostics, ProgressCallback, RenderJob } from "../../renderOrchestrator.js";
import type { CompositionMetadata } from "../shared.js";
import {
  decodeHdrImageBuffers,
  extractHdrVideoFrames,
  planHdrResources,
  probeHdrExtractionDims,
} from "./captureHdrResources.js";
import { partitionTransitionFrames, shouldUseHybridLayeredPath } from "./captureHdrFrameShared.js";
import { runSequentialLayeredFrameLoop } from "./captureHdrSequentialLoop.js";
import { runHybridLayeredFrameLoop } from "./captureHdrHybridLoop.js";
import { wrapCaptureStageError } from "../captureStageError.js";
import type { HdrLayeredCapturePlan } from "../capturePlan.js";

export interface CaptureHdrStageInput {
  job: RenderJob;
  cfg: EngineConfig;
  /** Immutable layered route selected by the sequencer. */
  plan: HdrLayeredCapturePlan;
  log: ProducerLogger;

  projectDir: string;
  compiledDir: string;
  framesDir: string;
  videoOnlyPath: string;

  width: number;
  height: number;
  totalFrames: number;

  composition: CompositionMetadata;
  hasHdrContent: boolean;
  effectiveHdr: { transfer: HdrTransfer } | undefined;
  nativeHdrVideoIds: Set<string>;
  nativeHdrImageIds: Set<string>;
  videoTransfers: Map<string, HdrTransfer>;
  imageTransfers: Map<string, HdrTransfer>;
  hdrImageSrcPaths: Map<string, string>;

  preset: ReturnType<typeof getEncoderPreset>;
  effectiveQuality: number;
  effectiveBitrate: string | undefined;

  fileServer: FileServerHandle;
  buildCaptureOptions: () => CaptureOptions;
  createRenderVideoFrameInjector: () => BeforeCaptureHook | null;

  /** Mutated in place (counters incremented). */
  hdrDiagnostics: HdrDiagnostics;

  abortSignal: AbortSignal | undefined;
  assertNotAborted: () => void;
  onProgress?: ProgressCallback;
}

export interface CaptureHdrStageResult {
  lastBrowserConsole: string[];
  hdrPerf: HdrPerfCollector | undefined;
  /** Wall-clock ms for the HDR capture phase. */
  captureDurationMs: number;
  /** ffmpeg-reported encode duration; overlapped with capture. */
  encodeMs: number;
  warnings: CaptureWarning[];
}

function cloneCaptureWarnings(warnings: readonly CaptureWarning[]): CaptureWarning[] {
  return warnings.map((warning) => ({
    ...warning,
    details: warning.details
      ? {
          ...warning.details,
          sources: warning.details.sources ? [...warning.details.sources] : undefined,
        }
      : undefined,
  }));
}

export async function runCaptureHdrStage(
  input: CaptureHdrStageInput,
): Promise<CaptureHdrStageResult> {
  const {
    job,
    cfg,
    plan,
    log,
    projectDir,
    compiledDir,
    framesDir,
    videoOnlyPath,
    width,
    height,
    totalFrames,
    composition,
    hasHdrContent,
    effectiveHdr,
    nativeHdrVideoIds,
    nativeHdrImageIds,
    videoTransfers,
    imageTransfers,
    hdrImageSrcPaths,
    preset,
    effectiveQuality,
    effectiveBitrate,
    fileServer,
    buildCaptureOptions,
    createRenderVideoFrameInjector,
    hdrDiagnostics,
    abortSignal,
    assertNotAborted,
    onProgress,
  } = input;
  const { workerCount } = plan;

  const stageStart = Date.now();
  let lastBrowserConsole: string[] = [];
  let captureDurationMs = 0;
  let encodeMs = 0;
  const nativeHdrIds = new Set([...nativeHdrVideoIds, ...nativeHdrImageIds]);

  log.info(
    hasHdrContent
      ? "[Render] HDR layered composite: z-ordered DOM + native HDR video/image layers"
      : "[Render] Shader transition composite: z-ordered SDR DOM layers",
  );
  const hdrPerf: HdrPerfCollector = createHdrPerfCollector();

  // Layered compositing relies on captureAlphaPng (Page.captureScreenshot
  // with a transparent background) for DOM layers. That CDP call hangs
  // indefinitely when Chrome is launched with --enable-begin-frame-control
  // (the default on Linux/headless-shell), because the compositor is paused
  // and never produces a frame to capture. Use screenshot mode for the
  // entire layered path — same constraint as alpha output formats. We
  // derive a local `hdrCfg` instead of mutating the caller-owned `cfg`
  // so the value flowing through the rest of the pipeline is the one the
  // sequencer locked at compile time. (The HDR path is end-of-pipeline
  // today, but Phase 3 chunked rendering depends on stages not mutating
  // caller config.)
  const hdrCfg: EngineConfig = { ...cfg, forceScreenshot: true };

  if (!fileServer) throw new Error("fileServer must be initialized before HDR compositing");

  // Plan HDR resources (videos to extract, images to decode, layout-probe
  // start times) up-front — pure data transformation, no IO yet.
  const prep = planHdrResources({
    composition,
    nativeHdrVideoIds,
    nativeHdrImageIds,
    projectDir,
    compiledDir,
    existsSync,
  });

  const domSession = await createCaptureSession(
    fileServer.url,
    framesDir,
    buildCaptureOptions(),
    createRenderVideoFrameInjector(),
    hdrCfg,
  );

  let hdrEncoder: StreamingEncoder | null = null;
  let hdrEncoderClosed = false;
  let domSessionClosed = false;
  const hdrVideoFrameSources = new Map<string, HdrVideoFrameSource>();
  try {
    await initializeSession(domSession);
    assertNotAborted();
    lastBrowserConsole = domSession.browserConsoleBuffer;
    await initTransparentBackground(domSession.page);

    // ── Scene detection for shader transitions ──────────────────────────
    const transitionMeta: HdrTransitionMeta[] = await domSession.page.evaluate(() => {
      return window.__hf?.transitions ?? [];
    });
    const sceneElements: Record<string, string[]> = await domSession.page.evaluate(() => {
      const scenes = document.querySelectorAll(".scene");
      const map: Record<string, string[]> = {};
      for (const scene of scenes) {
        if (!scene.id) continue;
        const ids = new Set<string>([scene.id]);
        const els = scene.querySelectorAll("[id]");
        for (const el of els) {
          if (el.id) ids.add(el.id);
        }
        map[scene.id] = Array.from(ids);
      }
      return map;
    });
    const fpsDecimal = fpsToNumber(job.config.fps);
    const transitionRanges: TransitionRange[] = transitionMeta.map((t) => ({
      ...t,
      startFrame: Math.floor(t.time * fpsDecimal),
      endFrame: Math.ceil((t.time + t.duration) * fpsDecimal),
    }));
    if (transitionRanges.length > 0) {
      log.info("[Render] Detected shader transitions for layered compositing", {
        count: transitionRanges.length,
        transitions: transitionRanges.map((t) => ({
          shader: t.shader,
          from: t.fromScene,
          to: t.toScene,
          frames: `${t.startFrame}-${t.endFrame}`,
        })),
      });
    }

    hdrEncoder = await spawnStreamingEncoder(
      videoOnlyPath,
      {
        fps: job.config.fps,
        width,
        height,
        codec: preset.codec,
        preset: preset.preset,
        quality: effectiveQuality,
        bitrate: effectiveBitrate,
        pixelFormat: preset.pixelFormat,
        hdr: preset.hdr,
        rawInputFormat: "rgb48le",
      },
      abortSignal,
      { ffmpegStreamingTimeout: 3_600_000 },
    );
    assertNotAborted();

    // ── HDR resource probing + extraction ──────────────────────────────
    await probeHdrExtractionDims({
      domSession,
      nativeHdrIds,
      nativeHdrImageIds,
      composition,
      prep,
    });
    const extracted = await extractHdrVideoFrames({
      job,
      log,
      framesDir,
      composition,
      prep,
      width,
      height,
      abortSignal,
      hdrDiagnostics,
    });
    for (const [id, source] of extracted) hdrVideoFrameSources.set(id, source);
    const hdrImageBuffers = decodeHdrImageBuffers({
      log,
      hdrImageSrcPaths,
      prep,
      hdrDiagnostics,
    });

    assertNotAborted();

    try {
      const cleanedUpVideos = new Set<string>();
      const hdrVideoEndTimes = new Map<string, number>();
      for (const v of composition.videos) {
        if (hdrVideoFrameSources.has(v.id)) hdrVideoEndTimes.set(v.id, v.end);
      }

      const debugDumpEnabled = process.env.KEEP_TEMP === "1";
      const debugDumpDir = debugDumpEnabled ? join(framesDir, "debug-composite") : null;
      if (debugDumpDir && !existsSync(debugDumpDir)) {
        mkdirSync(debugDumpDir, { recursive: true });
      }
      const compositeTransfer = resolveCompositeTransfer(hasHdrContent, effectiveHdr);
      const hdrTargetTransfer = compositeTransfer === "srgb" ? undefined : compositeTransfer;
      const hdrCacheMaxBytes = process.env.HDR_TRANSFER_CACHE_MAX_BYTES
        ? Number(process.env.HDR_TRANSFER_CACHE_MAX_BYTES)
        : undefined;
      const hdrImageTransferCache = createHdrImageTransferCache(
        hdrCacheMaxBytes !== undefined ? { maxBytes: hdrCacheMaxBytes } : {},
      );
      const hdrCompositeCtx: HdrCompositeContext = {
        log,
        domSession,
        beforeCaptureHook: domSession.onBeforeCapture,
        width,
        height,
        fps: fpsToNumber(job.config.fps),
        compositeTransfer,
        nativeHdrImageIds,
        hdrImageBuffers,
        hdrImageTransferCache,
        hdrVideoFrameSources,
        hdrVideoStartTimes: prep.hdrVideoStartTimes,
        imageTransfers,
        videoTransfers,
        debugDumpEnabled,
        debugDumpDir,
        hdrPerf,
      };

      // ── Dispatch to sequential or hybrid frame loop ────────────────────
      const effectiveWorkerCount = Math.max(1, workerCount);
      const transitionFrameCount = partitionTransitionFrames(transitionRanges, totalFrames).size;
      const useHybrid = shouldUseHybridLayeredPath({
        hasHdrContent,
        transitionFramesCount: transitionFrameCount,
        totalFrames,
        workerCount: effectiveWorkerCount,
      });
      if (transitionRanges.length > 0) {
        log.info("[Render] Layered hybrid dispatch decision", {
          hybridEnabled: useHybrid,
          hasHdrContent,
          workerCount: effectiveWorkerCount,
          transitionFrameCount,
          totalFrames,
        });
      }

      if (useHybrid) {
        await runHybridLayeredFrameLoop({
          job,
          cfg: hdrCfg,
          log,
          framesDir,
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
          workerCount: effectiveWorkerCount,
          debugDumpEnabled,
          debugDumpDir,
          assertNotAborted,
          onProgress,
        });
      } else {
        await runSequentialLayeredFrameLoop({
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
        });
      }
    } finally {
      lastBrowserConsole = domSession.browserConsoleBuffer;
      await closeCaptureSession(domSession);
      domSessionClosed = true;
    }

    const hdrEncodeResult = await hdrEncoder.close();
    hdrEncoderClosed = true;
    assertNotAborted();
    if (!hdrEncodeResult.success) {
      throw new Error(`HDR encode failed: ${hdrEncodeResult.error}`);
    }
    captureDurationMs = Date.now() - stageStart;
    encodeMs = hdrEncodeResult.durationMs;
  } catch (error) {
    lastBrowserConsole = domSession.browserConsoleBuffer;
    throw wrapCaptureStageError(error, lastBrowserConsole);
  } finally {
    if (hdrEncoder && !hdrEncoderClosed) {
      try {
        await hdrEncoder.close();
      } catch (err) {
        log.warn("hdrEncoder defensive close failed", {
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }
    if (!domSessionClosed) {
      await closeCaptureSession(domSession).catch((err) => {
        log.warn("closeCaptureSession defensive close failed", {
          err: err instanceof Error ? err.message : String(err),
        });
      });
    }
    for (const frameSource of hdrVideoFrameSources.values()) {
      closeHdrVideoFrameSource(frameSource, log);
    }
    hdrVideoFrameSources.clear();
  }

  return {
    lastBrowserConsole,
    hdrPerf,
    captureDurationMs,
    encodeMs,
    warnings: cloneCaptureWarnings(domSession.warnings),
  };
}
