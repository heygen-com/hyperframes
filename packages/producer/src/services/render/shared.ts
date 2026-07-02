/**
 * Shared types and pure helpers used by the staged render pipeline.
 *
 * Lives in its own module so the stage files in `./stages/` can import the
 * helpers they need without reaching back into `renderOrchestrator.ts` —
 * the orchestrator imports the stage functions, so a runtime cycle would
 * otherwise form (and grow as more stages are extracted).
 *
 * `renderOrchestrator.ts` re-exports everything declared here for
 * backwards compatibility with existing test files and external callers.
 */

import { copyFileSync, cpSync, existsSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import {
  CANVAS_DIMENSIONS,
  checkOutputResolutionCompatibility,
  type CanvasResolution,
} from "@hyperframes/core";
import type {
  AudioElement,
  ExtractedFrames,
  ImageElement,
  VideoElement,
} from "@hyperframes/engine";
import type { CompiledComposition } from "../htmlCompiler.js";
import { defaultLogger, type ProducerLogger } from "../../logger.js";
import { isPathInside } from "../../utils/paths.js";
import type { ProgressCallback, RenderJob, RenderStatus } from "../renderOrchestrator.js";

export interface CompositionMetadata {
  duration: number;
  videos: VideoElement[];
  audios: AudioElement[];
  images: ImageElement[];
  width: number;
  height: number;
}

/**
 * Floating-point tolerance for reconciling browser-discovered media timing
 * against statically-parsed metadata. Used when the browser reports a
 * slightly different `end` / `mediaStart` / `volume` than the compiled
 * HTML and we want to ignore sub-millisecond float noise.
 */
export const BROWSER_MEDIA_EPSILON = 0.0001;

export function writeFileExclusiveSync(path: string, data: NodeJS.ArrayBufferView | string): void {
  try {
    writeFileSync(path, data, { flag: "wx", mode: 0o600 });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "EEXIST") {
      return;
    }
    throw error;
  }
}

/**
 * Browser-discovered media inside inlined sub-compositions can still report
 * scene-local timing from the merged DOM (e.g. start=0, end=85.52) while the
 * compiled metadata is already offset into the parent host timeline
 * (e.g. start=4.417, end=89.937). Reproject browser end-time into the
 * compiled element's time origin before reconciling it back into the render
 * metadata.
 */
export function projectBrowserEndToCompositionTimeline(
  existingStart: number,
  browserStart: number,
  browserEnd: number,
): number {
  return browserEnd + (existingStart - browserStart);
}

/**
 * Translate the user-facing `--resolution` flag into a Chrome
 * `deviceScaleFactor`. The composition's intrinsic dimensions stay the
 * page-layout viewport; the screenshot lands at output dims via DPR.
 *
 * The scale must be a positive integer ≥ 1 — fractional DPRs introduce
 * visible aliasing and we'd rather fail loudly than produce a blurry
 * 4K render. Downsampling (output < composition) is rejected because
 * the user is unlikely to have intended it; if the use case appears
 * we can plumb a separate flag.
 *
 * Throws on:
 *   - HDR + outputResolution (HDR compositor processes raw pixel buffers
 *     at composition dimensions and would need parallel scaling).
 *   - Aspect-ratio mismatch (e.g. landscape composition → portrait-4k).
 *   - Non-integer scale ratio.
 *   - Downsampling (output dimensions smaller than composition).
 */
export function resolveDeviceScaleFactor(input: {
  compositionWidth: number;
  compositionHeight: number;
  outputResolution: CanvasResolution | undefined;
  hdrRequested: boolean;
  alphaRequested: boolean;
}): number {
  if (!input.outputResolution) return 1;
  // Single source of truth for the aspect/alpha/HDR/scale constraints, shared
  // with the CLI render pre-flight so both raise the identical, actionable
  // message. This is the deep defense-in-depth throw; the pre-flight aborts
  // long before this runs on the common (aspect/alpha) mistakes.
  const compat = checkOutputResolutionCompatibility({
    compositionWidth: input.compositionWidth,
    compositionHeight: input.compositionHeight,
    outputResolution: input.outputResolution,
    alphaRequested: input.alphaRequested,
    hdrRequested: input.hdrRequested,
  });
  if (!compat.ok) throw new Error(compat.message);

  const target = CANVAS_DIMENSIONS[input.outputResolution];
  // Aspect ratios match → widthRatio === heightRatio. Compute once.
  return target.width / input.compositionWidth;
}

/**
 * Write compiled HTML and sub-compositions to the work directory.
 *
 * Exported for integration tests. Not part of the stable public API —
 * callers outside this package should use `executeRenderJob` instead.
 */
export function writeCompiledArtifacts(
  compiled: CompiledComposition,
  workDir: string,
  includeSummary: boolean,
): void {
  const compileDir = join(workDir, "compiled");
  mkdirSync(compileDir, { recursive: true });

  writeFileSync(join(compileDir, "index.html"), compiled.html, "utf-8");

  for (const [srcPath, html] of compiled.subCompositions) {
    const outPath = join(compileDir, srcPath);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, html, "utf-8");
  }

  // Copy external assets (files outside projectDir) into the compiled directory
  // so the file server can serve them. The safe-path check uses
  // `isPathInside()` rather than a hardcoded separator — on Windows,
  // `compileDir + "/"` never matches because paths use `\\`, which caused
  // every external asset to be wrongly rejected as "unsafe" (see GH #321).
  for (const [relativePath, absolutePath] of compiled.externalAssets) {
    const outPath = resolve(join(compileDir, relativePath));
    if (!isPathInside(outPath, compileDir)) {
      console.warn(`[Render] Skipping external asset with unsafe path: ${relativePath}`);
      continue;
    }
    mkdirSync(dirname(outPath), { recursive: true });
    copyFileSync(absolutePath, outPath);
  }

  if (includeSummary) {
    const summary = {
      width: compiled.width,
      height: compiled.height,
      staticDuration: compiled.staticDuration,
      videos: compiled.videos.map((v) => ({
        id: v.id,
        src: v.src,
        start: v.start,
        end: v.end,
        mediaStart: v.mediaStart,
      })),
      audios: compiled.audios.map((a) => ({
        id: a.id,
        src: a.src,
        start: a.start,
        end: a.end,
        mediaStart: a.mediaStart,
      })),
      subCompositions: Array.from(compiled.subCompositions.keys()),
      renderModeHints: compiled.renderModeHints,
      hasShaderTransitions: compiled.hasShaderTransitions,
    };
    writeFileSync(join(compileDir, "summary.json"), JSON.stringify(summary, null, 2), "utf-8");
  }
}

export interface RenderModeHintResult {
  /** Resolved capture-mode boolean after folding in the hint. */
  forceScreenshot: boolean;
  /** True iff the hint flipped a `false` input to `true` (warn log fired). */
  autoSelected: boolean;
}

/**
 * Fold the composition's `renderModeHints.recommendScreenshot` signal
 * into the caller's already-resolved `forceScreenshot` value. Pure: the
 * caller owns the assignment to its own config. When the hint is the
 * deciding factor (caller passed `false`, hint says recommend), fires
 * the auto-select warn log with the composition's reason codes.
 */
export function applyRenderModeHints(
  alreadyForced: boolean,
  compiled: CompiledComposition,
  log: ProducerLogger = defaultLogger,
): RenderModeHintResult {
  if (alreadyForced || !compiled.renderModeHints.recommendScreenshot) {
    return { forceScreenshot: alreadyForced, autoSelected: false };
  }
  log.warn("Auto-selected screenshot capture mode for render compatibility", {
    reasonCodes: compiled.renderModeHints.reasons.map((reason) => reason.code),
    reasons: compiled.renderModeHints.reasons.map((reason) => reason.message),
  });
  return { forceScreenshot: true, autoSelected: true };
}

/**
 * Mutate the `RenderJob` view of the pipeline's progress and fire the
 * caller's `onProgress` callback. Hoisted here (out of `renderOrchestrator.ts`)
 * so the stage modules can call it without forming a runtime cycle.
 *
 * `completedAt` is stamped on the terminal `"failed"` / `"complete"`
 * transitions so callers that poll the job state can tell when the
 * pipeline finished.
 */
export function updateJobStatus(
  job: RenderJob,
  status: RenderStatus,
  stage: string,
  progress: number,
  onProgress?: ProgressCallback,
): void {
  job.status = status;
  job.currentStage = stage;
  job.progress = progress;
  if (status === "failed" || status === "complete") job.completedAt = new Date();
  if (onProgress) onProgress(job, stage);
}

/**
 * Build a `resolver(framePath)` closure that maps an absolute path to
 * a frame inside `compiledDir` into a server-relative URL the producer's
 * file server will serve. Returns `null` for any path that escapes the
 * compiled directory — the resolver is used by the video frame injector
 * to rewrite local frame references into HTTP `<video>` srcs.
 */
export function createCompiledFrameSrcResolver(
  compiledDir: string,
): (framePath: string) => string | null {
  const compiledRoot = resolve(compiledDir);
  return (framePath: string): string | null => {
    const resolvedFramePath = resolve(framePath);
    if (!isPathInside(resolvedFramePath, compiledRoot)) return null;

    const relativePath = relative(compiledRoot, resolvedFramePath);
    if (!relativePath || relativePath.startsWith("..") || isAbsolute(relativePath)) {
      return null;
    }

    return `/${relativePath
      .split(/[\\/]+/)
      .map((segment) => encodeURIComponent(segment))
      .join("/")}`;
  };
}

type MaterializedExtractedFrames = Pick<ExtractedFrames, "videoId" | "outputDir" | "framePaths">;

type MaterializePathModule = {
  resolve: (...segments: string[]) => string;
  join: (...segments: string[]) => string;
  dirname: (path: string) => string;
  basename: (path: string) => string;
  relative: (from: string, to: string) => string;
  isAbsolute: (path: string) => boolean;
};

type MaterializeFileSystem = {
  existsSync: (path: string) => boolean;
  mkdirSync: (path: string, options: { recursive: true }) => unknown;
  symlinkSync: (target: string, path: string) => unknown;
  cpSync: (src: string, dest: string, options: { recursive: true }) => unknown;
};

type MaterializeExtractedFramesOptions = {
  pathModule?: MaterializePathModule;
  fileSystem?: MaterializeFileSystem;
  /**
   * When `true`, recursively copy frames into `compiledDir` as real files
   * instead of creating a single symlink per video. Required for
   * distributed plan() output where the planDir must be self-contained
   * across machines (symlinks don't survive S3 / GCS round-trips).
   * Default `false` preserves the in-process renderer's symlink behavior.
   */
  materializeSymlinks?: boolean;
};

const materializePathModule: MaterializePathModule = {
  resolve,
  join,
  dirname,
  basename,
  relative,
  isAbsolute,
};

const materializeFileSystem: MaterializeFileSystem = {
  existsSync,
  mkdirSync,
  symlinkSync,
  cpSync,
};

/**
 * Periodic peak-RSS / peak-heapUsed sampler. The benchmark harness reads
 * the peaks to detect memory regressions (e.g. unbounded image-cache
 * growth) that wall-clock metrics miss.
 *
 * Sampled every 250ms; the interval is `unref`'d so the sampler never
 * holds the event loop open on its own. Callers MUST invoke `stop()`
 * in a `finally` block — `stop()` takes one final reading before
 * clearing the interval so the peak values are accurate up to the
 * moment the render returns.
 */
export interface MemorySampler {
  /** Take an immediate sample then read the peak RSS in bytes. */
  peakRssBytes: () => number;
  /** Take an immediate sample then read the peak heap-used in bytes. */
  peakHeapUsedBytes: () => number;
  /** Stop the interval after one final sample. Idempotent. */
  stop: () => void;
}

export function createMemorySampler(intervalMs: number = 250): MemorySampler {
  let peakRss = 0;
  let peakHeap = 0;
  const sample = (): void => {
    try {
      const m = process.memoryUsage();
      if (m.rss > peakRss) peakRss = m.rss;
      if (m.heapUsed > peakHeap) peakHeap = m.heapUsed;
    } catch {
      // Defensive: process.memoryUsage() shouldn't throw, but if it ever
      // does we don't want to take down the render for a benchmark accessory.
    }
  };
  sample();
  const interval: NodeJS.Timeout = setInterval(sample, intervalMs);
  interval.unref();
  let stopped = false;
  return {
    // Resampling at read time means callers see the value at the
    // moment of inspection, not the last 250ms tick — important for
    // the success-path perf summary which captures peaks just before
    // returning.
    peakRssBytes: () => {
      sample();
      return peakRss;
    },
    peakHeapUsedBytes: () => {
      sample();
      return peakHeap;
    },
    stop: () => {
      if (stopped) return;
      stopped = true;
      sample();
      clearInterval(interval);
    },
  };
}

/**
 * Symlink (or copy) each extracted-frames directory into a stable path
 * under `compiledDir/__hyperframes_video_frames/<videoId>/`, and rewrite
 * the per-frame paths so the file server can serve them.
 *
 * Exported for integration tests; not part of the stable public API —
 * external callers should use `executeRenderJob` instead.
 */
export function materializeExtractedFramesForCompiledDir(
  extracted: MaterializedExtractedFrames[],
  compiledDir: string,
  options: MaterializeExtractedFramesOptions = {},
): void {
  const pathModule = options.pathModule ?? materializePathModule;
  const fileSystem = options.fileSystem ?? materializeFileSystem;
  const resolvedCompiledDir = pathModule.resolve(compiledDir);
  const compiledFrameRoot = pathModule.join(resolvedCompiledDir, "__hyperframes_video_frames");

  for (const ext of extracted) {
    const resolvedOut = pathModule.resolve(ext.outputDir);
    if (isPathInside(resolvedOut, resolvedCompiledDir, { pathModule })) continue;

    const linkPath = pathModule.join(compiledFrameRoot, ext.videoId);
    if (!fileSystem.existsSync(linkPath)) {
      fileSystem.mkdirSync(pathModule.dirname(linkPath), { recursive: true });
      if (options.materializeSymlinks) {
        fileSystem.cpSync(resolvedOut, linkPath, { recursive: true });
      } else {
        fileSystem.symlinkSync(resolvedOut, linkPath);
      }
    }

    const remapped = new Map<number, string>();
    for (const [idx, framePath] of ext.framePaths) {
      remapped.set(idx, pathModule.join(linkPath, pathModule.basename(framePath)));
    }
    ext.framePaths = remapped;
    ext.outputDir = linkPath;
  }
}
