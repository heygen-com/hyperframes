import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, win32 } from "node:path";
import { tmpdir } from "node:os";
import type { CaptureOptions, EngineConfig, ExtractedFrames } from "@hyperframes/engine";
import { executeParallelCapture, mergeWorkerFrames } from "@hyperframes/engine";
import type { CompiledComposition } from "./htmlCompiler.js";

// Replace only the two engine functions the adaptive-retry loop uses to touch
// disk; everything else (distributeFrames, types, etc.) stays real so the loop
// runs for real against a temp framesDir.
vi.mock("@hyperframes/engine", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@hyperframes/engine")>();
  return { ...actual, executeParallelCapture: vi.fn(), mergeWorkerFrames: vi.fn() };
});

import {
  buildMissingFrameRetryBatches,
  captureAttemptMadeProgress,
  closeOrphanedProbeForRetry,
  describeMemoryExhaustion,
  executeDiskCaptureWithAdaptiveRetry,
  collectVideoMetadataHints,
  collectVideoReadinessSkipIds,
  extractStandaloneEntryFromIndex,
  findMissingFrameRanges,
  getNextRetryWorkerCount,
  isRecoverableParallelCaptureError,
  MAX_TRANSIENT_CAPTURE_RETRIES,
  resolveCaptureForceScreenshotForPageSideCompositing,
  resolveRenderWorkDirPrefix,
  shouldDiscardProbeSessionForPageSideCompositing,
  resolveInversionRetryPlan,
  resolveParallelRouterRetryPlan,
  resetCaptureAttemptProgress,
  shouldRetryViaPinnedFallback,
  countElementTags,
  envInt,
  isDeParallelRouterEnabled,
  mergeWorkerInitObservability,
  resolveCompositionElementCount,
  resolveDeShortBand,
  shouldPreferParallelDrawElement,
  shouldPreferSingleWorkerDrawElement,
  shouldStreamParallelCapture,
  shouldUseStreamingEncode,
  resolveObservedCaptureMode,
  createCaptureObservabilityUpdater,
} from "./renderOrchestrator.js";
import { probeRequiresBrowser } from "./render/stages/probeStage.js";
import { ensureFrameWritten } from "./render/stages/captureHdrFrameShared.js";
import { resolveCompositeTransfer, shouldUseLayeredComposite } from "./hdrCompositor.js";
import {
  createCaptureCalibrationConfig,
  estimateCaptureCostMultiplier,
  estimateMeasuredCaptureCostMultiplier,
  resolveRenderWorkerCount,
  selectCaptureCalibrationFrames,
  shouldFallbackToScreenshotAfterCalibrationError,
} from "./render/captureCost.js";
import {
  applyRenderModeHints,
  createCompiledFrameSrcResolver,
  materializeExtractedFramesForCompiledDir,
  projectBrowserEndToCompositionTimeline,
  resolveDeviceScaleFactor,
  writeCompiledArtifacts,
} from "./render/shared.js";
import { formatCaptureFrameName, toExternalAssetKey } from "../utils/paths.js";

describe("resolveRenderWorkDirPrefix", () => {
  it("uses a short system temp prefix on Windows instead of the output path", () => {
    const outputPath = win32.join("C:\\deep", "nested".repeat(30), "renders", "final.mp4");

    expect(resolveRenderWorkDirPrefix(outputPath, "long-render-job-id", "win32", "C:/Temp")).toBe(
      join("C:/Temp", "hf-render-"),
    );
  });
});

describe("extractStandaloneEntryFromIndex", () => {
  it("reuses the index wrapper and keeps only the requested composition host", () => {
    const indexHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>body { background: #111; }</style>
</head>
<body>
  <div id="main" data-composition-id="root" data-width="1920" data-height="1080">
    <div id="intro" data-composition-id="intro" data-composition-src="compositions/intro.html" data-start="5"></div>
    <div id="outro" data-composition-id="outro" data-composition-src="compositions/outro.html" data-start="12"></div>
  </div>
</body>
</html>`;

    const extracted = extractStandaloneEntryFromIndex(indexHtml, "compositions/outro.html");

    expect(extracted).toContain('data-composition-id="root"');
    expect(extracted).toContain('id="outro"');
    expect(extracted).toContain('data-composition-src="compositions/outro.html"');
    expect(extracted).toContain('data-start="0"');
    expect(extracted).not.toContain('id="intro"');
    expect(extracted).toContain("<style>body { background: #111; }</style>");
  });

  it("matches normalized data-composition-src paths", () => {
    const indexHtml = `<!DOCTYPE html>
<html>
<body>
  <div data-composition-id="root" data-width="1920" data-height="1080">
    <div id="intro" data-composition-id="intro" data-composition-src="./compositions/intro.html" data-start="3"></div>
  </div>
</body>
</html>`;

    const extracted = extractStandaloneEntryFromIndex(indexHtml, "compositions/intro.html");

    expect(extracted).not.toBeNull();
    expect(extracted).toContain('data-start="0"');
    expect(extracted).toContain('data-composition-src="./compositions/intro.html"');
  });

  it("returns null when index.html does not mount the requested entry file", () => {
    const indexHtml = `<!DOCTYPE html>
<html>
<body>
  <div data-composition-id="root" data-width="1920" data-height="1080">
    <div id="intro" data-composition-id="intro" data-composition-src="compositions/intro.html"></div>
  </div>
</body>
</html>`;

    const extracted = extractStandaloneEntryFromIndex(indexHtml, "compositions/outro.html");

    expect(extracted).toBeNull();
  });

  it("re-points the wrapper duration at the scene's own, not the master's", () => {
    const indexHtml = `<!DOCTYPE html>
<html>
<body>
  <div data-composition-id="master" data-width="640" data-height="360" data-duration="12">
    <div id="scene1" data-composition-id="scene1" data-composition-src="compositions/scene1.html" data-start="0" data-duration="2"></div>
  </div>
</body>
</html>`;
    const sceneHtml = `<template id="scene1-template"><div data-composition-id="scene1" data-width="640" data-height="360" data-duration="3"></div></template>`;

    const extracted = extractStandaloneEntryFromIndex(
      indexHtml,
      "compositions/scene1.html",
      sceneHtml,
    );

    // The extracted standalone advertises the scene file's 3s, not the mount's 2s or master's 12s.
    expect(extracted).toContain('data-duration="3"');
    expect(extracted).not.toContain('data-duration="12"');
  });

  it("falls back to the mount's data-duration when the scene file isn't supplied", () => {
    const indexHtml = `<!DOCTYPE html>
<html>
<body>
  <div data-composition-id="master" data-width="640" data-height="360" data-duration="12">
    <div id="scene1" data-composition-id="scene1" data-composition-src="compositions/scene1.html" data-start="0" data-duration="2"></div>
  </div>
</body>
</html>`;

    const extracted = extractStandaloneEntryFromIndex(indexHtml, "compositions/scene1.html");

    expect(extracted).toContain('data-duration="2"');
    expect(extracted).not.toContain('data-duration="12"');
  });
});

describe("captureAttemptMadeProgress", () => {
  it("resets completed frames before a fallback attempt starts", () => {
    const job = { framesRendered: 900 };

    resetCaptureAttemptProgress(job);

    expect(job.framesRendered).toBe(0);
  });

  it("retries when the attempt captured at least one frame toward its target", () => {
    // targeted 100 frames, 40 still missing -> 60 captured -> worth retrying the rest
    expect(captureAttemptMadeProgress(100, 40)).toBe(true);
    expect(captureAttemptMadeProgress(100, 99)).toBe(true);
  });

  it("bails when the attempt captured nothing (structurally broken composition)", () => {
    // targeted 100 frames, 100 still missing -> zero progress -> don't burn another timeout cycle
    expect(captureAttemptMadeProgress(100, 100)).toBe(false);
    // defensive: never-greater-than guard, treat >= target as no progress
    expect(captureAttemptMadeProgress(100, 120)).toBe(false);
  });
});

describe("executeDiskCaptureWithAdaptiveRetry — zero-progress bail (integration)", () => {
  const makeLog = () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() });

  afterEach(() => {
    vi.mocked(executeParallelCapture).mockReset();
    vi.mocked(mergeWorkerFrames).mockReset();
  });

  it("runs exactly one attempt (no worker-halving retries) when an attempt captures zero frames", async () => {
    // Capture writes nothing -> framesDir stays empty -> every frame still missing.
    vi.mocked(executeParallelCapture).mockResolvedValue([]);
    vi.mocked(mergeWorkerFrames).mockResolvedValue(undefined);

    const workDir = mkdtempSync(join(tmpdir(), "hf-retry-work-"));
    const framesDir = mkdtempSync(join(tmpdir(), "hf-retry-frames-"));
    const log = makeLog();
    try {
      await expect(
        executeDiskCaptureWithAdaptiveRetry({
          serverUrl: "http://localhost:0",
          workDir,
          framesDir,
          totalFrames: 4,
          initialWorkerCount: 4,
          allowRetry: true,
          frameExt: "jpg",
          captureOptions: {} as CaptureOptions,
          createBeforeCaptureHook: () => null,
          cfg: {} as EngineConfig,
          log,
          dedupPerfs: [],
        }),
      ).rejects.toThrow(/4 frame\(s\) are missing/);

      // The gate under test: without it the loop would walk 4 -> 2 -> 1 workers
      // (3 capture calls) before giving up. One call proves it bailed immediately.
      expect(vi.mocked(executeParallelCapture)).toHaveBeenCalledTimes(1);
      expect(log.warn).toHaveBeenCalledWith(
        expect.stringContaining("no forward progress"),
        expect.objectContaining({ attempt: 0, frameCount: 4, remainingCount: 4 }),
      );
    } finally {
      rmSync(workDir, { recursive: true, force: true });
      rmSync(framesDir, { recursive: true, force: true });
    }
  });
});

describe("executeDiskCaptureWithAdaptiveRetry — transient Target-closed single retry (integration)", () => {
  const makeLog = () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() });

  const writeAllFrames = (framesDir: string, totalFrames: number): void => {
    for (let i = 0; i < totalFrames; i++) {
      writeFileSync(join(framesDir, formatCaptureFrameName(i, "jpg")), "captured-frame");
    }
  };

  afterEach(() => {
    vi.mocked(executeParallelCapture).mockReset();
    vi.mocked(mergeWorkerFrames).mockReset();
  });

  it("retries ONCE at the same worker count on a transient Target closed with zero progress", async () => {
    const workDir = mkdtempSync(join(tmpdir(), "hf-transient-work-"));
    const framesDir = mkdtempSync(join(tmpdir(), "hf-transient-frames-"));
    const log = makeLog();
    let call = 0;
    // First attempt: the tab dies before any frame is captured (frame 0) — zero
    // forward progress, which the worker-halving retry deliberately bails on.
    // The transient retry recovers it without changing the worker count.
    vi.mocked(executeParallelCapture).mockImplementation(async () => {
      call++;
      if (call === 1) {
        throw new Error("Protocol error (Page.captureScreenshot): Target closed");
      }
      writeAllFrames(framesDir, 4);
      return [];
    });
    vi.mocked(mergeWorkerFrames).mockResolvedValue(undefined);

    try {
      const attempts = await executeDiskCaptureWithAdaptiveRetry({
        serverUrl: "http://localhost:0",
        workDir,
        framesDir,
        totalFrames: 4,
        initialWorkerCount: 1,
        allowRetry: true,
        frameExt: "jpg",
        captureOptions: {} as CaptureOptions,
        createBeforeCaptureHook: () => null,
        cfg: {} as EngineConfig,
        log,
        dedupPerfs: [],
      });

      expect(vi.mocked(executeParallelCapture)).toHaveBeenCalledTimes(2);
      // Both attempts ran at the same worker count (transient retry doesn't halve).
      expect(attempts.map((a) => a.workers)).toEqual([1, 1]);
      // The retry attempt is tagged `transient-retry` (vs the worker-halving
      // `retry`) so it's countable for telemetry (dashboard 1783183).
      expect(attempts.map((a) => a.reason)).toEqual(["initial", "transient-retry"]);
      expect(log.warn).toHaveBeenCalledWith(
        expect.stringContaining("Transient browser failure"),
        expect.objectContaining({ transientRetriesUsed: 1 }),
      );
    } finally {
      rmSync(workDir, { recursive: true, force: true });
      rmSync(framesDir, { recursive: true, force: true });
    }
  });

  it("does NOT retry a transient error when the render was aborted", async () => {
    const workDir = mkdtempSync(join(tmpdir(), "hf-transient-abort-work-"));
    const framesDir = mkdtempSync(join(tmpdir(), "hf-transient-abort-frames-"));
    const log = makeLog();
    const controller = new AbortController();
    // Cancellation tears the browser down, surfacing as a transient-looking
    // "Target closed" — but an aborted render must fail immediately, not retry.
    vi.mocked(executeParallelCapture).mockImplementation(async () => {
      controller.abort();
      throw new Error("Target closed");
    });
    vi.mocked(mergeWorkerFrames).mockResolvedValue(undefined);

    try {
      await expect(
        executeDiskCaptureWithAdaptiveRetry({
          serverUrl: "http://localhost:0",
          workDir,
          framesDir,
          totalFrames: 4,
          initialWorkerCount: 2,
          allowRetry: true,
          frameExt: "jpg",
          captureOptions: {} as CaptureOptions,
          createBeforeCaptureHook: () => null,
          abortSignal: controller.signal,
          cfg: {} as EngineConfig,
          log,
          dedupPerfs: [],
        }),
      ).rejects.toThrow(/Target closed/);

      // Exactly one attempt — no transient retry burned on a cancelled render.
      expect(vi.mocked(executeParallelCapture)).toHaveBeenCalledTimes(1);
      expect(log.warn).not.toHaveBeenCalledWith(
        expect.stringContaining("Transient browser failure"),
        expect.anything(),
      );
    } finally {
      rmSync(workDir, { recursive: true, force: true });
      rmSync(framesDir, { recursive: true, force: true });
    }
  });

  it("gives up after MAX_TRANSIENT_CAPTURE_RETRIES when the tab keeps dying", async () => {
    const workDir = mkdtempSync(join(tmpdir(), "hf-transient2-work-"));
    const framesDir = mkdtempSync(join(tmpdir(), "hf-transient2-frames-"));
    const log = makeLog();
    vi.mocked(executeParallelCapture).mockRejectedValue(new Error("Session closed"));
    vi.mocked(mergeWorkerFrames).mockResolvedValue(undefined);

    try {
      await expect(
        executeDiskCaptureWithAdaptiveRetry({
          serverUrl: "http://localhost:0",
          workDir,
          framesDir,
          totalFrames: 4,
          initialWorkerCount: 1,
          allowRetry: true,
          frameExt: "jpg",
          captureOptions: {} as CaptureOptions,
          createBeforeCaptureHook: () => null,
          cfg: {} as EngineConfig,
          log,
          dedupPerfs: [],
        }),
      ).rejects.toThrow(/Session closed/);

      // 1 initial attempt + exactly MAX_TRANSIENT_CAPTURE_RETRIES retries.
      expect(vi.mocked(executeParallelCapture)).toHaveBeenCalledTimes(
        1 + MAX_TRANSIENT_CAPTURE_RETRIES,
      );
    } finally {
      rmSync(workDir, { recursive: true, force: true });
      rmSync(framesDir, { recursive: true, force: true });
    }
  });
});

describe("describeMemoryExhaustion", () => {
  it("returns actionable guidance for a memory-exhaustion error", () => {
    const msg = describeMemoryExhaustion(new Error("Set maximum size exceeded"), {
      width: 3840,
      height: 2160,
      totalFrames: 5400,
    });
    expect(msg).not.toBeNull();
    expect(msg).toContain("ran out of memory");
    expect(msg).toContain("3840×2160");
    expect(msg).toContain("5400 frames");
    expect(msg).toContain("Set maximum size exceeded");
    expect(msg).toContain("--low-memory-mode");
  });

  it("omits dimensions when they are unknown", () => {
    const msg = describeMemoryExhaustion(new Error("JavaScript heap out of memory"), {});
    expect(msg).not.toBeNull();
    expect(msg).not.toContain("×");
  });

  it("returns null for a non-memory error (leaves the original message intact)", () => {
    expect(
      describeMemoryExhaustion(new Error("Target closed"), {
        width: 1920,
        height: 1080,
        totalFrames: 100,
      }),
    ).toBeNull();
  });
});

describe("ensureFrameWritten", () => {
  it("returns without throwing when the frame was written", () => {
    expect(() => ensureFrameWritten(true, 0)).not.toThrow();
  });

  it("throws a bare frame-indexed error when no encoder context is supplied", () => {
    expect(() => ensureFrameWritten(false, 7)).toThrow(
      "Streaming encoder exited before frame 7 was written",
    );
  });

  it("includes the ffmpeg exit reason when the encoder reports one", () => {
    const encoder = { getExitError: () => "FFmpeg exited with code 1: Unknown encoder 'libx264'" };
    expect(() => ensureFrameWritten(false, 0, encoder)).toThrow(
      /Streaming encoder exited before frame 0 was written: FFmpeg exited with code 1: Unknown encoder 'libx264'/,
    );
  });

  it("falls back to the bare message when the encoder has no exit reason yet", () => {
    const encoder = { getExitError: () => undefined };
    expect(() => ensureFrameWritten(false, 3, encoder)).toThrow(
      "Streaming encoder exited before frame 3 was written",
    );
  });
});

describe("shouldUseStreamingEncode", () => {
  const streamingEnabledConfig = {
    enableStreamingEncode: true,
    streamingEncodeMaxDurationSeconds: 240,
    lowMemoryMode: false,
  };

  it("enables streaming for default single-worker video renders", () => {
    expect(shouldUseStreamingEncode(streamingEnabledConfig, "mp4", 1, 240)).toBe(true);
  });

  it("lets config disable streaming encode", () => {
    expect(
      shouldUseStreamingEncode(
        { enableStreamingEncode: false, streamingEncodeMaxDurationSeconds: 240 },
        "mp4",
        1,
        240,
      ),
    ).toBe(false);
  });

  it("keeps png-sequence and parallel capture on the non-streaming path", () => {
    expect(shouldUseStreamingEncode(streamingEnabledConfig, "png-sequence", 1, 240)).toBe(false);
    expect(shouldUseStreamingEncode(streamingEnabledConfig, "mp4", 2, 240)).toBe(false);
  });

  it("forceParallelStream overrides the parallel-capture clamp for verified multi-worker streaming", () => {
    expect(shouldUseStreamingEncode(streamingEnabledConfig, "mp4", 3, 240, true)).toBe(true);
    expect(shouldUseStreamingEncode(streamingEnabledConfig, "mp4", 3, 240, false)).toBe(false);
    expect(shouldUseStreamingEncode(streamingEnabledConfig, "png-sequence", 3, 240, true)).toBe(
      false,
    );
  });

  it("keeps renders over the configured max duration on normal encoding", () => {
    expect(shouldUseStreamingEncode(streamingEnabledConfig, "mp4", 1, 240)).toBe(true);
    expect(shouldUseStreamingEncode(streamingEnabledConfig, "mp4", 1, 240.001)).toBe(false);
    expect(
      shouldUseStreamingEncode(
        { enableStreamingEncode: true, streamingEncodeMaxDurationSeconds: 120 },
        "mp4",
        1,
        120.001,
      ),
    ).toBe(false);
  });

  it("keeps long single-worker renders streaming in low-memory mode", () => {
    expect(
      shouldUseStreamingEncode({ ...streamingEnabledConfig, lowMemoryMode: true }, "mp4", 1, 411),
    ).toBe(true);
  });
});

describe("createCompiledFrameSrcResolver", () => {
  it("maps extracted frame paths under compiledDir to encoded server URLs", () => {
    const resolver = createCompiledFrameSrcResolver("/tmp/hf job/compiled");

    expect(
      resolver("/tmp/hf job/compiled/__hyperframes_video_frames/video 1/frame_00001.jpg"),
    ).toBe("/__hyperframes_video_frames/video%201/frame_00001.jpg");
  });

  it("returns null for paths outside compiledDir", () => {
    const resolver = createCompiledFrameSrcResolver("/tmp/hf-job/compiled");

    expect(resolver("/tmp/hf-job/video-frames/frame_00001.jpg")).toBeNull();
  });

  it("resolves symlinked cache frames when materialized under compiledDir", () => {
    const resolver = createCompiledFrameSrcResolver("/tmp/hf-job/compiled");

    expect(resolver("/tmp/hf-job/compiled/__hyperframes_video_frames/vid1/frame_00001.jpg")).toBe(
      "/__hyperframes_video_frames/vid1/frame_00001.jpg",
    );

    expect(resolver("/tmp/cache/abc123/frame_00001.jpg")).toBeNull();
  });

  it("encodes reserved characters in frame path segments", () => {
    const resolver = createCompiledFrameSrcResolver("/tmp/hf-job/compiled");

    expect(
      resolver("/tmp/hf-job/compiled/__hyperframes_video_frames/video#1/frame_00001.jpg"),
    ).toBe("/__hyperframes_video_frames/video%231/frame_00001.jpg");

    expect(
      resolver("/tmp/hf-job/compiled/__hyperframes_video_frames/video?q=1/frame_00001.jpg"),
    ).toBe("/__hyperframes_video_frames/video%3Fq%3D1/frame_00001.jpg");
  });
});

describe("materializeExtractedFramesForCompiledDir", () => {
  function createExtractedFrames(
    outputDir: string,
    framePath: string,
  ): Pick<ExtractedFrames, "videoId" | "outputDir" | "framePaths"> {
    return {
      videoId: "video-1",
      outputDir,
      framePaths: new Map([[0, framePath]]),
    };
  }

  it("leaves Windows frame paths already under compiledDir unchanged", () => {
    const compiledDir = win32.resolve("C:\\compiled");
    const outputDir = win32.join(compiledDir, "__hyperframes_video_frames", "video-1");
    const framePath = win32.join(outputDir, "frame_000001.jpg");
    const extracted = createExtractedFrames(outputDir, framePath);

    materializeExtractedFramesForCompiledDir([extracted], compiledDir, {
      pathModule: win32,
      fileSystem: {
        existsSync: () => {
          throw new Error("inside compiledDir should not touch the filesystem");
        },
        mkdirSync: () => {
          throw new Error("inside compiledDir should not mkdir");
        },
        symlinkSync: () => {
          throw new Error("inside compiledDir should not symlink");
        },
        cpSync: () => {
          throw new Error("inside compiledDir should not copy");
        },
      },
    });

    expect(extracted.outputDir).toBe(outputDir);
    expect(extracted.framePaths.get(0)).toBe(framePath);
  });

  // fallow-ignore-next-line code-duplication
  it("remaps Windows cache frames under compiledDir using only the frame basename", () => {
    const compiledDir = win32.resolve("C:\\compiled");
    const outputDir = win32.resolve("D:\\cache\\abc123");
    const framePath = win32.join(outputDir, "frame_000001.jpg");
    const extracted = createExtractedFrames(outputDir, framePath);
    const symlinks: Array<{ target: string; path: string }> = [];

    // fallow-ignore-next-line code-duplication
    materializeExtractedFramesForCompiledDir([extracted], compiledDir, {
      pathModule: win32,
      fileSystem: {
        existsSync: () => false,
        mkdirSync: () => undefined,
        symlinkSync: (target, path) => {
          symlinks.push({ target, path });
        },
        cpSync: () => {
          throw new Error("symlink path should not invoke cpSync");
        },
      },
    });

    const linkPath = win32.join(compiledDir, "__hyperframes_video_frames", "video-1");
    expect(extracted.outputDir).toBe(linkPath);
    expect(extracted.framePaths.get(0)).toBe(win32.join(linkPath, "frame_000001.jpg"));
    expect(extracted.framePaths.get(0)).not.toContain(outputDir);
    expect(symlinks).toEqual([{ target: outputDir, path: linkPath }]);
  });

  // fallow-ignore-next-line code-duplication
  it("recursively copies frames into compiledDir when materializeSymlinks is true", () => {
    // Distributed plan() must produce a self-contained planDir — symlinks
    // don't survive S3 / GCS round-trips. With materializeSymlinks=true the
    // helper invokes cpSync(recursive) instead of symlinkSync.
    const compiledDir = win32.resolve("C:\\compiled");
    const outputDir = win32.resolve("D:\\cache\\abc123");
    const framePath = win32.join(outputDir, "frame_000001.jpg");
    const extracted = createExtractedFrames(outputDir, framePath);
    const copies: Array<{ src: string; dest: string; recursive: boolean }> = [];

    // fallow-ignore-next-line code-duplication
    materializeExtractedFramesForCompiledDir([extracted], compiledDir, {
      pathModule: win32,
      fileSystem: {
        existsSync: () => false,
        mkdirSync: () => undefined,
        symlinkSync: () => {
          throw new Error("copy path should not invoke symlinkSync");
        },
        cpSync: (src, dest, options) => {
          copies.push({ src, dest, recursive: options.recursive });
        },
      },
      materializeSymlinks: true,
    });

    const linkPath = win32.join(compiledDir, "__hyperframes_video_frames", "video-1");
    expect(extracted.outputDir).toBe(linkPath);
    expect(extracted.framePaths.get(0)).toBe(win32.join(linkPath, "frame_000001.jpg"));
    expect(copies).toEqual([{ src: outputDir, dest: linkPath, recursive: true }]);
  });

  // fallow-ignore-next-line code-duplication
  it("falls back to copying frames when symlinkSync fails with EPERM (Windows, no Developer Mode)", () => {
    // Windows without Developer Mode/Administrator rejects symlink creation with
    // EPERM — high/standard-quality renders failed here while draft worked. The
    // helper must degrade to a recursive copy instead of throwing.
    const compiledDir = win32.resolve("C:\\compiled");
    const outputDir = win32.resolve("D:\\cache\\abc123");
    const framePath = win32.join(outputDir, "frame_000001.jpg");
    const extracted = createExtractedFrames(outputDir, framePath);
    const copies: Array<{ src: string; dest: string; recursive: boolean }> = [];

    // fallow-ignore-next-line code-duplication
    materializeExtractedFramesForCompiledDir([extracted], compiledDir, {
      pathModule: win32,
      fileSystem: {
        existsSync: () => false,
        mkdirSync: () => undefined,
        symlinkSync: () => {
          const err: NodeJS.ErrnoException = new Error("EPERM: operation not permitted, symlink");
          err.code = "EPERM";
          throw err;
        },
        cpSync: (src, dest, options) => {
          copies.push({ src, dest, recursive: options.recursive });
        },
      },
    });

    const linkPath = win32.join(compiledDir, "__hyperframes_video_frames", "video-1");
    expect(copies).toEqual([{ src: outputDir, dest: linkPath, recursive: true }]);
    expect(extracted.outputDir).toBe(linkPath);
    expect(extracted.framePaths.get(0)).toBe(win32.join(linkPath, "frame_000001.jpg"));
  });

  it("rethrows a non-permission symlink error instead of masking it with a copy", () => {
    const compiledDir = win32.resolve("C:\\compiled");
    const outputDir = win32.resolve("D:\\cache\\abc123");
    const framePath = win32.join(outputDir, "frame_000001.jpg");
    const extracted = createExtractedFrames(outputDir, framePath);

    expect(() =>
      materializeExtractedFramesForCompiledDir([extracted], compiledDir, {
        pathModule: win32,
        fileSystem: {
          existsSync: () => false,
          mkdirSync: () => undefined,
          symlinkSync: () => {
            const err: NodeJS.ErrnoException = new Error("ENOSPC: no space left");
            err.code = "ENOSPC";
            throw err;
          },
          cpSync: () => {
            throw new Error("must not fall back to copy for a non-permission error");
          },
        },
      }),
    ).toThrow(/ENOSPC/);
  });

  // fallow-ignore-next-line code-duplication
  it("clears a stale dangling entry and re-stages when symlinkSync fails with EEXIST", () => {
    // After the extraction cache is GC'd, a symlink from a prior render dangles
    // (its target removed). existsSync() follows the dead link so the caller's
    // guard reads it as absent and reaches staging, but the link file itself
    // still exists, so symlinkSync collides with EEXIST. The helper must clear
    // the stale entry (rmSync) and re-stage, not hard-fail the render.
    const compiledDir = win32.resolve("C:\\compiled");
    const outputDir = win32.resolve("D:\\cache\\abc123");
    const framePath = win32.join(outputDir, "frame_000001.jpg");
    const extracted = createExtractedFrames(outputDir, framePath);
    const linkPath = win32.join(compiledDir, "__hyperframes_video_frames", "video-1");
    const removed: string[] = [];
    const symlinks: Array<{ target: string; path: string }> = [];
    let symlinkCalls = 0;

    // fallow-ignore-next-line code-duplication
    materializeExtractedFramesForCompiledDir([extracted], compiledDir, {
      pathModule: win32,
      fileSystem: {
        existsSync: () => false,
        mkdirSync: () => undefined,
        symlinkSync: (target, path) => {
          symlinkCalls += 1;
          if (symlinkCalls === 1) {
            const err: NodeJS.ErrnoException = new Error("EEXIST: file already exists, symlink");
            err.code = "EEXIST";
            throw err;
          }
          symlinks.push({ target, path });
        },
        cpSync: () => {
          throw new Error("EEXIST recovery should re-link, not copy");
        },
        rmSync: (path) => {
          removed.push(path);
        },
      },
    });

    expect(removed).toEqual([linkPath]);
    expect(symlinks).toEqual([{ target: outputDir, path: linkPath }]);
    expect(extracted.framePaths.get(0)).toBe(win32.join(linkPath, "frame_000001.jpg"));
  });

  // fallow-ignore-next-line code-duplication
  it("falls back to copying when symlinkSync fails with UNKNOWN (some Windows privilege denials)", () => {
    // Some Windows builds surface a no-symlink-privilege denial as an
    // UNKNOWN-coded error rather than EPERM/EACCES — it must still degrade to a
    // copy, not hard-fail the render.
    const compiledDir = win32.resolve("C:\\compiled");
    const outputDir = win32.resolve("D:\\cache\\abc123");
    const framePath = win32.join(outputDir, "frame_000001.jpg");
    const extracted = createExtractedFrames(outputDir, framePath);
    const copies: Array<{ src: string; dest: string; recursive: boolean }> = [];

    // fallow-ignore-next-line code-duplication
    materializeExtractedFramesForCompiledDir([extracted], compiledDir, {
      pathModule: win32,
      fileSystem: {
        existsSync: () => false,
        mkdirSync: () => undefined,
        symlinkSync: () => {
          const err: NodeJS.ErrnoException = new Error("UNKNOWN: unknown error, symlink");
          err.code = "UNKNOWN";
          throw err;
        },
        cpSync: (src, dest, options) => {
          copies.push({ src, dest, recursive: options.recursive });
        },
      },
    });

    const linkPath = win32.join(compiledDir, "__hyperframes_video_frames", "video-1");
    expect(copies).toEqual([{ src: outputDir, dest: linkPath, recursive: true }]);
    expect(extracted.framePaths.get(0)).toBe(win32.join(linkPath, "frame_000001.jpg"));
  });

  // fallow-ignore-next-line code-duplication
  it("clears a stale entry and re-copies when the eager-copy path (materializeSymlinks) hits EEXIST", () => {
    // #2025 routes Windows through the eager-copy branch. Reusing a dir a prior
    // Linux run populated with a (now dangling) symlink makes cpSync collide
    // with EEXIST — the recovery must clear the stale entry and re-copy, exactly
    // like the symlink path does.
    const compiledDir = win32.resolve("C:\\compiled");
    const outputDir = win32.resolve("D:\\cache\\abc123");
    const framePath = win32.join(outputDir, "frame_000001.jpg");
    const extracted = createExtractedFrames(outputDir, framePath);
    const linkPath = win32.join(compiledDir, "__hyperframes_video_frames", "video-1");
    const removed: string[] = [];
    const copies: Array<{ src: string; dest: string }> = [];
    let cpCalls = 0;

    // fallow-ignore-next-line code-duplication
    materializeExtractedFramesForCompiledDir([extracted], compiledDir, {
      pathModule: win32,
      materializeSymlinks: true,
      fileSystem: {
        existsSync: () => false,
        mkdirSync: () => undefined,
        symlinkSync: () => {
          throw new Error("eager-copy path must not symlink");
        },
        cpSync: (src, dest) => {
          cpCalls += 1;
          if (cpCalls === 1) {
            const err: NodeJS.ErrnoException = new Error("EEXIST: file already exists, cp");
            err.code = "EEXIST";
            throw err;
          }
          copies.push({ src, dest });
        },
        rmSync: (path) => {
          removed.push(path);
        },
      },
    });

    expect(removed).toEqual([linkPath]);
    expect(copies).toEqual([{ src: outputDir, dest: linkPath }]);
    expect(extracted.framePaths.get(0)).toBe(win32.join(linkPath, "frame_000001.jpg"));
  });
});

describe("writeCompiledArtifacts — external assets on Windows drive-letter paths (GH #321)", () => {
  const tempDirs: string[] = [];
  afterEach(() => {
    while (tempDirs.length > 0) {
      const d = tempDirs.pop();
      if (d) {
        try {
          rmSync(d, { recursive: true, force: true });
        } catch {
          /* ignore */
        }
      }
    }
  });

  function makeWorkDir(): string {
    const d = mkdtempSync(join(tmpdir(), "hf-orch-"));
    tempDirs.push(d);
    return d;
  }

  it("copies an external asset with a Windows-style drive-letter key into compileDir", () => {
    const workDir = makeWorkDir();
    const sourceDir = mkdtempSync(join(tmpdir(), "hf-src-"));
    tempDirs.push(sourceDir);
    const srcFile = join(sourceDir, "segment.wav");
    writeFileSync(srcFile, "fake wav bytes");

    const windowsStyleInput = "D:\\coder\\assets\\segment.wav";
    const key = toExternalAssetKey(windowsStyleInput);
    expect(key).toBe("hf-ext/D/coder/assets/segment.wav");

    const externalAssets = new Map<string, string>([[key, srcFile]]);
    const compiled = {
      html: "<!doctype html><html><body></body></html>",
      subCompositions: new Map<string, string>(),
      videos: [],
      audios: [],
      unresolvedCompositions: [],
      externalAssets,
      width: 1920,
      height: 1080,
      staticDuration: 10,
      renderModeHints: {
        recommendScreenshot: false,
        reasons: [],
      },
      hasShaderTransitions: false,
    };

    writeCompiledArtifacts(compiled, workDir, false);

    const landed = join(workDir, "compiled", key);
    expect(existsSync(landed)).toBe(true);
    expect(readFileSync(landed, "utf-8")).toBe("fake wav bytes");
  });

  it("rejects a maliciously crafted key that tries to escape compileDir", () => {
    const sandboxRoot = mkdtempSync(join(tmpdir(), "hf-orch-root-"));
    tempDirs.push(sandboxRoot);
    const workDir = join(sandboxRoot, "work", "inner");
    mkdirSync(workDir, { recursive: true });
    const sourceDir = mkdtempSync(join(tmpdir(), "hf-src-"));
    tempDirs.push(sourceDir);
    const srcFile = join(sourceDir, "evil.wav");
    writeFileSync(srcFile, "should never be copied");

    const externalAssets = new Map<string, string>([["hf-ext/../../etc/passwd", srcFile]]);
    const compiled = {
      html: "<!doctype html>",
      subCompositions: new Map<string, string>(),
      videos: [],
      audios: [],
      unresolvedCompositions: [],
      externalAssets,
      width: 1920,
      height: 1080,
      staticDuration: 10,
      renderModeHints: {
        recommendScreenshot: false,
        reasons: [],
      },
      hasShaderTransitions: false,
    };

    writeCompiledArtifacts(compiled, workDir, false);

    const escapeTarget = join(workDir, "etc", "passwd");
    expect(existsSync(escapeTarget)).toBe(false);
  });
});

function createCompiledComposition(
  reasonCodes: Array<"iframe" | "requestAnimationFrame">,
): CompiledComposition {
  return {
    html: "<html></html>",
    subCompositions: new Map(),
    videos: [],
    audios: [],
    unresolvedCompositions: [],
    externalAssets: new Map(),
    width: 1920,
    height: 1080,
    staticDuration: 5,
    renderModeHints: {
      recommendScreenshot: reasonCodes.length > 0,
      reasons: reasonCodes.map((code) => ({
        code,
        message: `reason: ${code}`,
      })),
    },
    hasShaderTransitions: false,
  };
}

// fallow-ignore-next-line code-duplication
function createConfig(): EngineConfig {
  return {
    fps: 30,
    quality: "standard",
    format: "jpeg",
    jpegQuality: 80,
    concurrency: "auto",
    coresPerWorker: 2.5,
    minParallelFrames: 120,
    largeRenderThreshold: 1000,
    disableGpu: false,
    browserGpuMode: "software",
    enableBrowserPool: false,
    browserTimeout: 120000,
    protocolTimeout: 300000,
    forceScreenshot: false,
    lowMemoryMode: false,
    enableChunkedEncode: false,
    chunkSizeFrames: 360,
    enableStreamingEncode: false,
    streamingEncodeMaxDurationSeconds: 240,
    ffmpegEncodeTimeout: 600000,
    ffmpegProcessTimeout: 300000,
    ffmpegStreamingTimeout: 600000,
    hdr: false,
    hdrAutoDetect: true,
    audioGain: 1,
    frameDataUriCacheLimit: 256,
    frameDataUriCacheBytesLimitMb: 1500,
    playerReadyTimeout: 45000,
    renderReadyTimeout: 15000,
    verifyRuntime: true,
    debug: false,
  };
}

describe("applyRenderModeHints", () => {
  // fallow-ignore-next-line code-duplication
  it("forces screenshot mode when compatibility hints recommend it", () => {
    const compiled = createCompiledComposition(["iframe", "requestAnimationFrame"]);
    const log = {
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
    };

    const result = applyRenderModeHints(false, compiled, log);

    expect(result).toEqual({ forceScreenshot: true, autoSelected: true });
    expect(log.warn).toHaveBeenCalledOnce();
  });

  it("does nothing when screenshot mode is already forced", () => {
    const compiled = createCompiledComposition(["iframe"]);
    const log = {
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
    };

    const result = applyRenderModeHints(true, compiled, log);

    expect(result).toEqual({ forceScreenshot: true, autoSelected: false });
    expect(log.warn).not.toHaveBeenCalled();
  });

  // fallow-ignore-next-line code-duplication
  it("returns false when neither caller nor hint forces", () => {
    const compiled = createCompiledComposition([]);
    const log = {
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
    };

    const result = applyRenderModeHints(false, compiled, log);

    expect(result).toEqual({ forceScreenshot: false, autoSelected: false });
    expect(log.warn).not.toHaveBeenCalled();
  });
});

describe("collectVideoReadinessSkipIds", () => {
  it("skips native metadata waits for every injected video with dimensions", () => {
    expect(
      collectVideoReadinessSkipIds(new Set(["hdr-video"]), [
        { videoId: "video1", metadata: { width: 1920, height: 1080 } },
        { videoId: "video2", metadata: { width: 1920, height: 1080 } },
        { videoId: "video3", metadata: { width: 1920, height: 1080 } },
        { videoId: "hdr-video", metadata: { width: 1920, height: 1080 } },
        { videoId: "bad-metadata", metadata: { width: 0, height: 0 } },
      ]),
    ).toEqual(["hdr-video", "video1", "video2", "video3"]);
  });
});

describe("collectVideoMetadataHints", () => {
  it("passes extracted video dimensions to capture sessions", () => {
    expect(
      collectVideoMetadataHints([
        { videoId: "video2", metadata: { width: 1080, height: 1920, durationSeconds: 4 } },
        { videoId: "video1", metadata: { width: 1920, height: 1080, durationSeconds: 12 } },
        { videoId: "bad-metadata", metadata: { width: 0, height: 1080, durationSeconds: 1 } },
      ]),
    ).toEqual([
      { id: "video1", width: 1920, height: 1080 },
      { id: "video2", width: 1080, height: 1920 },
    ]);
  });
});

describe("resolveRenderWorkerCount", () => {
  const cfg = { ...createConfig(), coresPerWorker: 100 };

  it("reduces auto workers for expensive capture workloads", () => {
    const log = {
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
    };

    const workers = resolveRenderWorkerCount(
      180,
      undefined,
      cfg,
      {
        hasShaderTransitions: true,
        renderModeHints: { recommendScreenshot: false, reasons: [] },
      },
      log,
    );

    expect(workers).toBe(1);
    expect(log.warn).toHaveBeenCalledOnce();
  });

  it("respects explicit worker requests", () => {
    const log = {
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
    };

    const workers = resolveRenderWorkerCount(
      180,
      6,
      cfg,
      {
        hasShaderTransitions: true,
        renderModeHints: { recommendScreenshot: false, reasons: [] },
      },
      log,
    );

    expect(workers).toBe(6);
    expect(log.warn).not.toHaveBeenCalled();
  });

  it("uses measured capture cost when static hints miss an expensive composition", () => {
    const workers = resolveRenderWorkerCount(
      180,
      undefined,
      cfg,
      {
        hasShaderTransitions: false,
        renderModeHints: { recommendScreenshot: false, reasons: [] },
      },
      undefined,
      { multiplier: 4, reasons: ["calibration-p95=2400ms"] },
    );

    expect(workers).toBe(1);
  });

  // fallow-ignore-next-line code-duplication
  it("forces single worker when html-in-canvas is detected", () => {
    const log = {
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
    };

    const workers = resolveRenderWorkerCount(
      900,
      undefined,
      cfg,
      {
        hasShaderTransitions: false,
        renderModeHints: {
          recommendScreenshot: false,
          reasons: [{ code: "htmlInCanvas", message: "layoutsubtree canvas" }],
        },
      },
      log,
    );

    expect(workers).toBe(1);
    expect(log.warn).toHaveBeenCalledOnce();
  });

  // fallow-ignore-next-line code-duplication
  it("overrides explicit --workers when html-in-canvas is detected", () => {
    const log = {
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
    };

    const workers = resolveRenderWorkerCount(
      900,
      8,
      cfg,
      {
        hasShaderTransitions: false,
        renderModeHints: {
          recommendScreenshot: false,
          reasons: [{ code: "htmlInCanvas", message: "layoutsubtree canvas" }],
        },
      },
      log,
    );

    expect(workers).toBe(1);
    expect(log.warn).toHaveBeenCalledOnce();
  });

  // fallow-ignore-next-line code-duplication
  it("pins to 1 worker in low-memory mode when no explicit --workers is set", () => {
    const log = {
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
    };

    const workers = resolveRenderWorkerCount(
      900,
      undefined,
      { ...cfg, lowMemoryMode: true },
      {
        hasShaderTransitions: false,
        renderModeHints: { recommendScreenshot: false, reasons: [] },
      },
      log,
    );

    expect(workers).toBe(1);
    expect(log.info).toHaveBeenCalledOnce();
  });

  // fallow-ignore-next-line code-duplication
  it("respects explicit --workers in low-memory mode (only the pin is bypassed)", () => {
    const log = {
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
    };

    const workers = resolveRenderWorkerCount(
      900,
      4,
      { ...cfg, lowMemoryMode: true, coresPerWorker: 2.5 },
      {
        hasShaderTransitions: false,
        renderModeHints: { recommendScreenshot: false, reasons: [] },
      },
      log,
    );

    expect(workers).toBe(4);
  });

  it("keeps baseline auto workers after screenshot fallback when measured capture is cheap", () => {
    const log = {
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
    };

    const stableCfg = {
      ...cfg,
      concurrency: 2 as const,
      largeRenderThreshold: 1_000,
    };
    const workers = resolveRenderWorkerCount(
      180,
      undefined,
      { ...stableCfg, forceScreenshot: true },
      {
        hasShaderTransitions: false,
        renderModeHints: { recommendScreenshot: false, reasons: [] },
      },
      log,
      { multiplier: 1, reasons: [], p95Ms: 180 },
    );

    expect(workers).toBe(2);
    expect(log.warn).not.toHaveBeenCalled();
  });
});

describe("resolveCaptureForceScreenshotForPageSideCompositing", () => {
  it("forces screenshot capture when page-side shader compositing is active", () => {
    expect(
      resolveCaptureForceScreenshotForPageSideCompositing({
        forceScreenshot: false,
        usePageSideCompositing: true,
      }),
    ).toBe(true);
  });

  it("preserves the existing capture mode when page-side compositing is inactive", () => {
    expect(
      resolveCaptureForceScreenshotForPageSideCompositing({
        forceScreenshot: false,
        usePageSideCompositing: false,
      }),
    ).toBe(false);
    expect(
      resolveCaptureForceScreenshotForPageSideCompositing({
        forceScreenshot: true,
        usePageSideCompositing: false,
      }),
    ).toBe(true);
  });
});

describe("shouldDiscardProbeSessionForPageSideCompositing", () => {
  it("discards a previously-loaded probe page when page-side compositing is selected", () => {
    expect(
      shouldDiscardProbeSessionForPageSideCompositing({
        hasProbeSession: true,
        usePageSideCompositing: true,
      }),
    ).toBe(true);
  });

  it("reuses the probe session when no page-side pre-head script is required", () => {
    expect(
      shouldDiscardProbeSessionForPageSideCompositing({
        hasProbeSession: true,
        usePageSideCompositing: false,
      }),
    ).toBe(false);
    expect(
      shouldDiscardProbeSessionForPageSideCompositing({
        hasProbeSession: false,
        usePageSideCompositing: true,
      }),
    ).toBe(false);
  });
});

describe("estimateCaptureCostMultiplier", () => {
  it("weights shader transitions and render mode hints without charging static media cost", () => {
    const cost = estimateCaptureCostMultiplier({
      hasShaderTransitions: true,
      renderModeHints: {
        recommendScreenshot: true,
        reasons: [{ code: "requestAnimationFrame", message: "raw rAF" }],
      },
    });

    expect(cost.multiplier).toBe(4);
    expect(cost.reasons).toEqual(["shader-transitions", "requestAnimationFrame"]);
  });
});

describe("shouldUseLayeredComposite", () => {
  it("uses the layered compositor for SDR shader transition renders", () => {
    expect(
      shouldUseLayeredComposite({
        hasHdrContent: false,
        hasShaderTransitions: true,
        isPngSequence: false,
      }),
    ).toBe(true);
  });

  it("does not route PNG sequence shader renders through the streaming layered compositor", () => {
    expect(
      shouldUseLayeredComposite({
        hasHdrContent: false,
        hasShaderTransitions: true,
        isPngSequence: true,
      }),
    ).toBe(false);
  });

  it("keeps HDR content on the layered compositor even without shader transitions", () => {
    expect(
      shouldUseLayeredComposite({
        hasHdrContent: true,
        hasShaderTransitions: false,
        isPngSequence: false,
      }),
    ).toBe(true);
  });
});

describe("resolveCompositeTransfer", () => {
  it("uses 16-bit-expanded sRGB for SDR layered shader transition renders", () => {
    expect(resolveCompositeTransfer(false, undefined)).toBe("srgb");
  });

  it("uses the active HDR transfer when HDR content is being preserved", () => {
    expect(resolveCompositeTransfer(true, { transfer: "hlg" })).toBe("hlg");
  });
});

describe("estimateMeasuredCaptureCostMultiplier", () => {
  it("turns slow calibration samples into a capture cost multiplier", () => {
    const estimate = estimateMeasuredCaptureCostMultiplier([
      { frameIndex: 0, captureTimeMs: 180 },
      { frameIndex: 45, captureTimeMs: 700 },
      { frameIndex: 90, captureTimeMs: 2400 },
      { frameIndex: 135, captureTimeMs: 900 },
    ]);

    expect(estimate.multiplier).toBe(4);
    expect(estimate.reasons).toEqual(["calibration-p95=2400ms"]);
  });

  it("keeps fast calibration samples at baseline cost", () => {
    const estimate = estimateMeasuredCaptureCostMultiplier([
      { frameIndex: 0, captureTimeMs: 120 },
      { frameIndex: 60, captureTimeMs: 180 },
      { frameIndex: 119, captureTimeMs: 220 },
    ]);

    expect(estimate.multiplier).toBe(1);
    expect(estimate.reasons).toEqual([]);
  });
});

describe("selectCaptureCalibrationFrames", () => {
  it("samples the start, middle, end, and quartiles without duplicates", () => {
    expect(selectCaptureCalibrationFrames(180)).toEqual([0, 45, 90, 135, 179]);
    expect(selectCaptureCalibrationFrames(3)).toEqual([0, 1, 2]);
  });
});

describe("capture calibration safeguards", () => {
  it("caps protocol timeout at calibration ceiling for fast fallback", () => {
    const cfg = createConfig();
    const calibrationCfg = createCaptureCalibrationConfig(cfg);

    // Default 300s is above the 30s calibration ceiling — cap at 30s
    // so a wedged BeginFrame times out fast and falls back to screenshot
    expect(calibrationCfg.protocolTimeout).toBe(30000);
    expect(cfg.protocolTimeout).toBe(300000);
  });

  it("preserves user timeout when already below calibration ceiling", () => {
    const cfg = createConfig();
    cfg.protocolTimeout = 5000;

    // 5s is below the 30s ceiling — keep the user's value
    expect(createCaptureCalibrationConfig(cfg).protocolTimeout).toBe(5000);
  });

  it("falls back to screenshot mode after beginFrame calibration failures", () => {
    expect(
      shouldFallbackToScreenshotAfterCalibrationError(
        new Error("HeadlessExperimental.beginFrame timed out"),
      ),
    ).toBe(true);
    expect(shouldFallbackToScreenshotAfterCalibrationError(new Error("ffmpeg exited"))).toBe(false);
  });

  it("falls back to screenshot mode after Runtime.callFunctionOn timeout during calibration", () => {
    expect(
      shouldFallbackToScreenshotAfterCalibrationError(
        new Error(
          "Runtime.callFunctionOn timed out. Increase the 'protocolTimeout' setting in launch/connect calls for a higher timeout if needed.",
        ),
      ),
    ).toBe(true);
    expect(
      shouldFallbackToScreenshotAfterCalibrationError(
        new Error(
          "Runtime.evaluate timed out. Increase the 'protocolTimeout' setting in launch/connect calls for a higher timeout if needed.",
        ),
      ),
    ).toBe(true);
  });
});

describe("adaptive missing-frame retry helpers", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      const d = tempDirs.pop();
      if (d) rmSync(d, { recursive: true, force: true });
    }
  });

  function makeFramesDir(): string {
    const d = mkdtempSync(join(tmpdir(), "hf-missing-frames-"));
    tempDirs.push(d);
    return d;
  }

  it("finds contiguous missing frame ranges from captured disk frames", () => {
    const framesDir = makeFramesDir();
    for (const frameIndex of [0, 1, 4]) {
      writeFileSync(
        join(framesDir, `frame_${String(frameIndex).padStart(6, "0")}.jpg`),
        "captured-frame",
      );
    }

    expect(findMissingFrameRanges(6, framesDir, "jpg")).toEqual([
      { startFrame: 2, endFrame: 4 },
      { startFrame: 5, endFrame: 6 },
    ]);
  });

  it("retries a worker placeholder instead of accepting a truncated sequence", () => {
    const framesDir = makeFramesDir();
    for (let frameIndex = 0; frameIndex < 4; frameIndex++) {
      writeFileSync(
        join(framesDir, `frame_${String(frameIndex).padStart(6, "0")}.jpg`),
        frameIndex === 2 ? "x" : "captured-frame",
      );
    }

    expect(findMissingFrameRanges(4, framesDir, "jpg")).toEqual([{ startFrame: 2, endFrame: 3 }]);
  });

  it("builds retry batches that cap active workers per attempt", () => {
    const batches = buildMissingFrameRetryBatches(
      [
        { startFrame: 2, endFrame: 4 },
        { startFrame: 5, endFrame: 6 },
        { startFrame: 9, endFrame: 12 },
      ],
      2,
      "/tmp/work",
      1,
    );

    expect(batches).toHaveLength(2);
    expect(batches[0]).toMatchObject([
      { workerId: 0, startFrame: 2, endFrame: 4 },
      { workerId: 1, startFrame: 5, endFrame: 6 },
    ]);
    expect(batches[1]).toMatchObject([{ workerId: 0, startFrame: 9, endFrame: 12 }]);
    expect(batches[0][0].outputDir).toContain("retry-1-batch-0-worker-0");
  });

  it("halves retry workers until sequential fallback", () => {
    expect(getNextRetryWorkerCount(8)).toBe(4);
    expect(getNextRetryWorkerCount(3)).toBe(1);
    expect(getNextRetryWorkerCount(2)).toBe(1);
    expect(getNextRetryWorkerCount(1)).toBe(1);
  });

  it("only retries parallel capture timeout failures", () => {
    expect(
      isRecoverableParallelCaptureError(
        new Error("[Parallel] Capture failed: Worker 0: Runtime.callFunctionOn timed out"),
      ),
    ).toBe(true);
    expect(
      isRecoverableParallelCaptureError(
        new Error("[Parallel] Capture failed: Worker 1: HeadlessExperimental.beginFrame timed out"),
      ),
    ).toBe(true);
    expect(
      isRecoverableParallelCaptureError(
        new Error(
          "[Parallel] Capture failed: Worker 0: drawElement worker encode timed out (frame 42)",
        ),
      ),
    ).toBe(true);
    expect(isRecoverableParallelCaptureError(new Error("Encoding failed: ffmpeg exited"))).toBe(
      false,
    );
  });
});

describe("projectBrowserEndToCompositionTimeline", () => {
  it("keeps end unchanged when browser and compiled starts share the same origin", () => {
    expect(projectBrowserEndToCompositionTimeline(2, 2, 6)).toBe(6);
  });

  it("reprojects a scene-local browser end into the compiled host timeline", () => {
    expect(projectBrowserEndToCompositionTimeline(4.417, 0, 85.52)).toBeCloseTo(89.937, 6);
  });

  it("preserves scene-local media offsets inside compositions that start much later", () => {
    expect(projectBrowserEndToCompositionTimeline(21.5, 1.5, 5.5)).toBe(25.5);
  });
});

describe("resolveDeviceScaleFactor", () => {
  const defaults = {
    compositionWidth: 1920,
    compositionHeight: 1080,
    hdrRequested: false,
    alphaRequested: false,
  } as const;

  it("returns 1 when no outputResolution is set (default behavior)", () => {
    expect(resolveDeviceScaleFactor({ ...defaults, outputResolution: undefined })).toBe(1);
  });

  it("returns 2 for the canonical 1080p → 4K supersample", () => {
    expect(resolveDeviceScaleFactor({ ...defaults, outputResolution: "landscape-4k" })).toBe(2);
  });

  it("returns 2 for portrait 1080p → portrait-4k", () => {
    expect(
      resolveDeviceScaleFactor({
        ...defaults,
        compositionWidth: 1080,
        compositionHeight: 1920,
        outputResolution: "portrait-4k",
      }),
    ).toBe(2);
  });

  it("returns 1 when the composition already matches the requested resolution", () => {
    expect(
      resolveDeviceScaleFactor({
        ...defaults,
        compositionWidth: 3840,
        compositionHeight: 2160,
        outputResolution: "landscape-4k",
      }),
    ).toBe(1);
  });

  it("rejects HDR + outputResolution with a clear message", () => {
    expect(() =>
      resolveDeviceScaleFactor({
        ...defaults,
        outputResolution: "landscape-4k",
        hdrRequested: true,
      }),
    ).toThrow(/hdrMode='force-hdr'/);
  });

  it("rejects alpha + outputResolution (the alpha capture path doesn't apply DPR yet)", () => {
    expect(() =>
      resolveDeviceScaleFactor({
        ...defaults,
        outputResolution: "landscape-4k",
        alphaRequested: true,
      }),
    ).toThrow(/alpha output/);
  });

  it("rejects orientation mismatch (landscape comp → portrait-4k)", () => {
    expect(() =>
      resolveDeviceScaleFactor({ ...defaults, outputResolution: "portrait-4k" }),
    ).toThrow(/aspect ratio/);
  });

  it("suggests the matching-orientation preset in the aspect-mismatch message", () => {
    // Landscape composition + portrait preset → the message should point at
    // the landscape swap so the user isn't left to guess (workstream P1-3).
    expect(() => resolveDeviceScaleFactor({ ...defaults, outputResolution: "portrait" })).toThrow(
      /--resolution landscape/,
    );
  });

  it("rejects downsampling (4K composition → 1080p output)", () => {
    expect(() =>
      resolveDeviceScaleFactor({
        ...defaults,
        compositionWidth: 3840,
        compositionHeight: 2160,
        outputResolution: "landscape",
      }),
    ).toThrow(/Downsampling/);
  });

  it("rejects non-integer scale factors", () => {
    // 1500×844 → 3840×2160 has slightly different ratios in width vs height.
    // The aspect-ratio guard fires first; pinning the rejection message
    // covers both error paths since either is an acceptable failure here.
    expect(() =>
      resolveDeviceScaleFactor({
        ...defaults,
        compositionWidth: 1500,
        compositionHeight: 844,
        outputResolution: "landscape-4k",
      }),
    ).toThrow(/aspect ratio|non-integer/);
  });

  it("returns 1 for a square comp matching the square preset", () => {
    expect(
      resolveDeviceScaleFactor({
        ...defaults,
        compositionWidth: 1080,
        compositionHeight: 1080,
        outputResolution: "square",
      }),
    ).toBe(1);
  });

  it("returns 2 for square 1080 → square-4k", () => {
    expect(
      resolveDeviceScaleFactor({
        ...defaults,
        compositionWidth: 1080,
        compositionHeight: 1080,
        outputResolution: "square-4k",
      }),
    ).toBe(2);
  });

  it("rejects landscape preset on a square composition", () => {
    expect(() =>
      resolveDeviceScaleFactor({
        ...defaults,
        compositionWidth: 1080,
        compositionHeight: 1080,
        outputResolution: "landscape",
      }),
    ).toThrow(/aspect ratio/);
  });
});

describe("shouldPreferSingleWorkerDrawElement (DE priority inversion)", () => {
  const eligible = {
    workerCount: 5,
    requestedWorkers: "auto" as const,
    useDrawElement: true,
    deCompileGate: undefined,
    forceScreenshot: false,
    outputFormat: "mp4" as const,
    totalFrames: 2380,
    minFrames: 900,
    singleWorkerStreamingOk: true,
    layeredOrEffectRoute: false,
    supersampling: false,
    probeDeGated: false,
    experimentalParallelDeOptIn: false,
  };

  it("inverts an auto-resolved multi-worker render for an eligible long comp", () => {
    expect(shouldPreferSingleWorkerDrawElement(eligible)).toBe(true);
  });

  // ── Short-comp band ──────────────────────────────────────────────────────────────────────
  // The call site evaluates the predicate TWICE — once at the 900 floor, once
  // at the 250 band floor — and the band is DECISIVE only when the calls
  // disagree. These pin that arithmetic, including the property the design
  // depends on: the band can only ADD inversions, never remove one.
  //
  // Measured basis (400f, single-DE vs parallel-screenshot-W4, ratio = ss4/de1
  // so >1 means DE wins):
  //   24 movers /     0 nodes -> 1.05   |   24 movers /  7000 nodes -> 0.96
  //  320 movers /     0 nodes -> 1.24   |   24 movers / 20000 nodes -> 0.71
  //  320 movers /  7000 nodes -> 1.09   |   24 movers / 40000 nodes -> 0.55
  // Motion helps DE, DOM size punishes it; the element ceiling is calibrated
  // at the lowest-motion case so every higher-motion comp is covered too.
  describe("short-comp band decisiveness (two-floor evaluation)", () => {
    const BAND_FLOOR = Math.min(900, 250);
    const atBase = (totalFrames: number, over?: Partial<typeof eligible>) =>
      shouldPreferSingleWorkerDrawElement({ ...eligible, ...over, totalFrames, minFrames: 900 });
    const atBand = (totalFrames: number, over?: Partial<typeof eligible>) =>
      shouldPreferSingleWorkerDrawElement({
        ...eligible,
        ...over,
        totalFrames,
        minFrames: BAND_FLOOR,
      });

    it("is decisive exactly in the 250-899 window for an otherwise-eligible render", () => {
      expect(atBand(400) && !atBase(400)).toBe(true);
      expect(atBand(250) && !atBase(250)).toBe(true);
      expect(atBand(899) && !atBase(899)).toBe(true);
    });

    it("is NOT decisive below the band floor — nothing fires either way", () => {
      expect(atBand(200)).toBe(false);
      expect(atBase(200)).toBe(false);
    });

    it("is NOT decisive at 900+ — the pre-existing floor already inverts, unchanged", () => {
      expect(atBase(2380)).toBe(true);
      expect(atBand(2380) && !atBase(2380)).toBe(false);
    });

    it("is NOT decisive when the render is ineligible for any other reason — the attribution cohort must exclude renders the band cannot affect", () => {
      for (const over of [
        { requestedWorkers: 3 as const },
        { useDrawElement: false },
        { deCompileGate: "css_effect:filter" },
        { forceScreenshot: true },
        { outputFormat: "webm" as const },
        { singleWorkerStreamingOk: false },
        { probeDeGated: true },
      ]) {
        expect(atBand(400, over)).toBe(false);
      }
    });

    it("HF_DE_SHORT_MIN_FRAMES=0 disables via the predicate's own minFrames guard", () => {
      expect(
        shouldPreferSingleWorkerDrawElement({
          ...eligible,
          totalFrames: 400,
          minFrames: Math.min(900, 0),
        }),
      ).toBe(false);
    });
  });

  describe("resolveDeShortBand", () => {
    const live = { elementCountSource: "live" as const };

    it("reports applied only when decisive, live-measured, and under the ceiling", () => {
      expect(
        resolveDeShortBand({
          ...live,
          invertAtBaseFloor: false,
          invertAtBandFloor: true,
          bandEnabled: true,
          bandOpen: true,
        }),
      ).toBe("applied");
    });

    it("reports skipped_elements when live-measured and over the ceiling", () => {
      expect(
        resolveDeShortBand({
          ...live,
          invertAtBaseFloor: false,
          invertAtBandFloor: true,
          bandEnabled: true,
          bandOpen: false,
        }),
      ).toBe("skipped_elements");
    });

    it("is undefined when the base floor already inverts — the band changed nothing", () => {
      expect(
        resolveDeShortBand({
          ...live,
          invertAtBaseFloor: true,
          invertAtBandFloor: true,
          bandEnabled: true,
          bandOpen: true,
        }),
      ).toBeUndefined();
    });

    it("is undefined when neither floor inverts — the render was ineligible for some other reason", () => {
      expect(
        resolveDeShortBand({
          ...live,
          invertAtBaseFloor: false,
          invertAtBandFloor: false,
          bandEnabled: true,
          bandOpen: true,
        }),
      ).toBeUndefined();
    });

    // Review finding (R1 + R2, both reviewers): HF_DE_SHORT_MAX_ELEMENTS=0
    // must read as "band disabled" (undefined), never "comp too large"
    // (skipped_elements) — the latter would poison the DiD control cohort by
    // mislabeling a kill-switch event as a real oversize measurement.
    it("HF_DE_SHORT_MAX_ELEMENTS=0 (bandEnabled=false) reports undefined even when the render would otherwise be decisive", () => {
      expect(
        resolveDeShortBand({
          ...live,
          invertAtBaseFloor: false,
          invertAtBandFloor: true, // an otherwise-eligible in-band render
          bandEnabled: false, // the kill switch
          bandOpen: false, // deShortBandOpen also false when the switch is off
        }),
      ).toBeUndefined();
    });

    // Review finding (R4): the probe supplying the live count is conditional,
    // so a static count is an UNBOUNDED undercount on runtime-generated DOM.
    // It must never produce "applied" (would route a 40k-node comp) and must
    // never produce "skipped_elements" either (would contaminate the DiD
    // control cohort with a number that isn't a real oversize observation).
    it("fails closed to unmeasured when the count came from the static scan, never applied", () => {
      expect(
        resolveDeShortBand({
          elementCountSource: "static",
          invertAtBaseFloor: false,
          invertAtBandFloor: true,
          bandEnabled: true,
          bandOpen: true, // static scan said "small" — must NOT be believed
        }),
      ).toBe("unmeasured");
    });

    it("reports unmeasured (not skipped_elements) for a static count over the ceiling — it is not a real observation either", () => {
      expect(
        resolveDeShortBand({
          elementCountSource: "static",
          invertAtBaseFloor: false,
          invertAtBandFloor: true,
          bandEnabled: true,
          bandOpen: false,
        }),
      ).toBe("unmeasured");
    });

    it("stays undefined for a static count when the band was not decisive anyway", () => {
      expect(
        resolveDeShortBand({
          elementCountSource: "static",
          invertAtBaseFloor: true,
          invertAtBandFloor: true,
          bandEnabled: true,
          bandOpen: true,
        }),
      ).toBeUndefined();
    });
  });

  // Review finding (R4), end-to-end: the review asked for a regression with a
  // known duration, no media / unresolved compositions, and >2500
  // script-created nodes, asserting it cannot enter `applied` without a live
  // count. This walks the real decision chain rather than a full render —
  // the probe gate, the count resolver, and the band attribution are each the
  // production function, wired in the same order the pipeline wires them.
  describe("no-probe dynamic-DOM composition cannot enter the applied cohort (R4 regression)", () => {
    // A caption-style comp: known duration, no media, builds 4000 spans in
    // its own init script. Mirrors packages/producer/tests/style-10-prod.
    const DYNAMIC_DOM_HTML = [
      '<div id="root"><div id="captions"></div></div>',
      "<script>",
      '  const c = document.getElementById("captions");',
      "  for (let i = 0; i < 4000; i++) {",
      '    const el = document.createElement("span");',
      "    el.textContent = String(i);",
      "    c.appendChild(el);",
      "  }",
      "</script>",
    ].join("\n");

    it("gets no browser probe — none of the probe conditions fire for this shape", () => {
      expect(
        probeRequiresBrowser({
          durationSeconds: 13.3, // known
          unresolvedCompositionCount: 0, // resolved
          hasAutoStart: false, // no media
          hasScriptedAudio: false,
          hasVariableMedia: false,
          // createElement("span") is not createElement("video"|"audio")
          hasInsertedMedia: false,
        }),
      ).toBe(false);
    });

    it("therefore measures statically, and the static count wildly understates the live DOM", async () => {
      const resolved = await resolveCompositionElementCount(null, DYNAMIC_DOM_HTML);
      expect(resolved.source).toBe("static");
      // Source markup has a handful of tags; the live DOM would have 4000+.
      expect(resolved.count).toBeLessThan(2500);
    });

    it("and therefore reports unmeasured — never applied — so it cannot route or join either cohort", async () => {
      const { count, source } = await resolveCompositionElementCount(null, DYNAMIC_DOM_HTML);
      const bandOpen = source === "live" && count <= 2500;
      const band = resolveDeShortBand({
        // A 400-frame render that would otherwise be perfectly eligible.
        invertAtBaseFloor: false,
        invertAtBandFloor: true,
        bandEnabled: true,
        bandOpen,
        elementCountSource: source,
      });
      expect(band).toBe("unmeasured");
      expect(band).not.toBe("applied");
    });
  });

  describe("mergeWorkerInitObservability", () => {
    it("max-merges across workers and ignores workers that reported nothing", () => {
      expect(
        mergeWorkerInitObservability([
          { initDurationMs: 400, initTweenCount: 900, initElementCount: 1200 },
          {},
          { initDurationMs: 1250, initTweenCount: 880, initElementCount: 1190 },
        ]),
      ).toEqual({ initDurationMs: 1250, tweenCount: 900, elementCount: 1200 });
    });

    it("returns undefined when no worker reported — summary.init must stay absent, not zeroed", () => {
      expect(mergeWorkerInitObservability([])).toBeUndefined();
      expect(mergeWorkerInitObservability([{}, {}])).toBeUndefined();
    });

    it("surfaces an element count even when a worker reported nothing else", () => {
      expect(mergeWorkerInitObservability([{ initElementCount: 4000 }])).toEqual({
        initDurationMs: undefined,
        tweenCount: undefined,
        elementCount: 4000,
      });
    });
  });

  describe("countElementTags", () => {
    it("counts closing tags", () => {
      expect(countElementTags("<div><span>a</span></div>")).toBe(2);
    });

    it("counts void elements — an image gallery must not read as a tiny comp", () => {
      expect(countElementTags("<img><br><hr>")).toBe(3);
      expect(countElementTags('<img src="a.png"><IMG SRC="b.png">')).toBe(2);
    });

    // Review-flagged blocker (v1): SVG elements are neither closing-tag-shaped
    // nor in the HTML void list, so a self-closing-SVG-heavy comp read as
    // element count 0 — an UNBOUNDED undercount, the same failure class as
    // the original <img> counterexample, and the exact shape of comp the
    // measured 1.8x regression case is made of. The ceiling cannot bound an
    // error that has no bound of its own.
    it("counts self-closing SVG elements — the 40k-node regression case must not read as empty", () => {
      expect(countElementTags("<circle/>".repeat(40000))).toBe(40000);
      expect(countElementTags('<path d="M0 0 L1 1" stroke="red" />')).toBe(1);
      expect(countElementTags("<feGaussianBlur stdDeviation='2'/>")).toBe(1);
    });

    it("does not double-count a self-closed void element (still just 1)", () => {
      expect(countElementTags('<img src="a.png"/>')).toBe(1);
      expect(countElementTags('<img src="a.png" />')).toBe(1);
    });

    it("does not false-positive on minified JS division-after-comparison (the self-closing alt's real risk)", () => {
      // Unspaced "<b/c>" is the adversarial case: "<" IS immediately
      // followed by a letter, so the generic self-closing alt gets as far as
      // starting a match — but it still requires the literal two-char "/>"
      // sequence, and here a "c" sits between the "/" and the ">", so
      // backtracking never finds one and it correctly fails to match.
      expect(countElementTags("if(a<b/c>d){}")).toBe(0);
    });

    it("does not false-positive on inline-script comparisons or void-prefixed words", () => {
      // Script bodies are stripped wholesale (with their own closing tag), so
      // nothing inside can match — including "<breadth" / "<imgWidth", which
      // would anyway fail the \b word boundary.
      expect(countElementTags("<script>if (a < b && x <breadth && y <imgWidth) {}</script>")).toBe(
        0,
      );
    });

    // Review finding: the `</[a-zA-Z]` alternation matches ANY "</" + letter,
    // including inside JS strings and template literals. Compiled comps embed
    // large inline scripts, so this bias is systematic — and it lands entirely
    // on the ~83% of renders with no probe, for which this scan is the only
    // element signal.
    it("does not count closing tags written inside inline script strings", () => {
      expect(countElementTags('<div></div><script>const h = "</div></div></div>";</script>')).toBe(
        1,
      );
      expect(
        countElementTags("<p></p><script>const t = words.map(w => `</span>`).join('');</script>"),
      ).toBe(1);
    });

    it("strips <style> bodies too — CSS content strings can carry the same shapes", () => {
      expect(countElementTags('<div></div><style>a::after{content:"</div>"}</style>')).toBe(1);
    });

    // CodeQL "incomplete multi-character sanitization": a single-pass replace
    // can reform the very pattern it removed. Impact is nil here (the stripped
    // string is counted, never rendered) but a reformed tag would perturb the
    // count, so the strip runs to a fixed point.
    it("strips script tags that reform after one pass", () => {
      // Inner <script> removed by pass 1 leaves "<script>alert(1)</script>",
      // which pass 2 removes. A single pass would leave a stray tag behind.
      expect(countElementTags("<div></div><scr<script></script>ipt>alert(1)</script>")).toBe(1);
    });

    it("terminates on input with no closing tag rather than looping", () => {
      expect(countElementTags("<div></div><script>unterminated")).toBe(1);
    });

    it("strips multiple and attributed script blocks, not just the first", () => {
      expect(
        countElementTags(
          '<div></div><script type="module">"</span>"</script><script>"</span>"</script>',
        ),
      ).toBe(1);
    });

    it("is stable on empty and malformed input rather than throwing", () => {
      expect(countElementTags("")).toBe(0);
      expect(countElementTags("<<<>>>")).toBe(0);
    });

    it("scales to a large document without a full parse", () => {
      expect(countElementTags("<p>x</p>".repeat(40000))).toBe(40000);
    });
  });

  describe("resolveCompositionElementCount", () => {
    // Review finding (R3): a static scan of SOURCE markup cannot see DOM a
    // composition's own script creates at runtime (document.createElement) —
    // an unbounded undercount no regex can close. style-10-prod's real
    // per-transcript-word caption generator is exactly this shape: 2 source
    // tags, thousands of live nodes after init.
    //
    // Review finding (R4): the probe that provides the live count is
    // CONDITIONAL, so the fallback cases below are not merely "less precise"
    // — they are UNSAFE to gate on, and every one of them must report
    // provenance "static" so the caller can fail closed.
    it("uses the live DOM count from an initialized probe session, ignoring the (much smaller) source scan", async () => {
      const session = { isInitialized: true, page: { evaluate: async () => 40001 } };
      expect(await resolveCompositionElementCount(session, "<div><span></span></div>")).toEqual({
        count: 40001,
        source: "live",
      });
    });

    it("reports static provenance when there is no probe session", async () => {
      expect(await resolveCompositionElementCount(null, "<div><span></span></div>")).toEqual({
        count: 2,
        source: "static",
      });
    });

    it("reports static provenance when the probe session is not yet initialized", async () => {
      const session = { isInitialized: false, page: { evaluate: async () => 999 } };
      expect(await resolveCompositionElementCount(session, "<div></div>")).toEqual({
        count: 1,
        source: "static",
      });
    });

    it("reports static provenance when page.evaluate throws (detached frame, mid-navigation)", async () => {
      const session = {
        isInitialized: true,
        page: {
          evaluate: async () => {
            throw new Error("Execution context was destroyed");
          },
        },
      };
      expect(await resolveCompositionElementCount(session, "<div><span></span></div>")).toEqual({
        count: 2,
        source: "static",
      });
    });

    it("reports static provenance when evaluate resolves a non-finite value", async () => {
      const session = { isInitialized: true, page: { evaluate: async () => Number.NaN } };
      expect(await resolveCompositionElementCount(session, "<div></div>")).toEqual({
        count: 1,
        source: "static",
      });
    });
  });

  describe("envInt", () => {
    afterEach(() => {
      delete process.env.HF_TEST_ENV_INT;
    });

    it("falls back when unset, empty, or non-numeric — a typo must not disable a guard", () => {
      expect(envInt("HF_TEST_ENV_INT", 2500)).toBe(2500);
      process.env.HF_TEST_ENV_INT = "";
      expect(envInt("HF_TEST_ENV_INT", 2500)).toBe(2500);
      process.env.HF_TEST_ENV_INT = "lots";
      expect(envInt("HF_TEST_ENV_INT", 2500)).toBe(2500);
    });

    it("reads an explicit value, including 0 as a real disable", () => {
      process.env.HF_TEST_ENV_INT = "700";
      expect(envInt("HF_TEST_ENV_INT", 2500)).toBe(700);
      process.env.HF_TEST_ENV_INT = "0";
      expect(envInt("HF_TEST_ENV_INT", 2500)).toBe(0);
    });
  });

  it("honors explicitly requested workers", () => {
    expect(shouldPreferSingleWorkerDrawElement({ ...eligible, requestedWorkers: 3 })).toBe(false);
  });

  it("inverts for requestedWorkers undefined — the value production actually passes for auto", () => {
    expect(shouldPreferSingleWorkerDrawElement({ ...eligible, requestedWorkers: undefined })).toBe(
      true,
    );
  });

  it("skips comps routed to layered/HDR/shader paths (drawElement never runs there)", () => {
    expect(shouldPreferSingleWorkerDrawElement({ ...eligible, layeredOrEffectRoute: true })).toBe(
      false,
    );
  });

  it("skips supersampled renders (engine init-time DE gate)", () => {
    expect(shouldPreferSingleWorkerDrawElement({ ...eligible, supersampling: true })).toBe(false);
  });

  it("skips when the probe session already shows DE gated out", () => {
    expect(shouldPreferSingleWorkerDrawElement({ ...eligible, probeDeGated: true })).toBe(false);
  });

  it("honors the explicit experimental parallel-DE opt-in", () => {
    expect(
      shouldPreferSingleWorkerDrawElement({ ...eligible, experimentalParallelDeOptIn: true }),
    ).toBe(false);
  });

  it("skips below the amortization threshold (measured crossover ~900 frames)", () => {
    expect(shouldPreferSingleWorkerDrawElement({ ...eligible, totalFrames: 360 })).toBe(false);
    expect(shouldPreferSingleWorkerDrawElement({ ...eligible, totalFrames: 900 })).toBe(true);
  });

  it("is disabled by minFrames <= 0 (HF_DE_SINGLE_MIN_FRAMES=0 kill switch)", () => {
    expect(shouldPreferSingleWorkerDrawElement({ ...eligible, minFrames: 0 })).toBe(false);
    expect(shouldPreferSingleWorkerDrawElement({ ...eligible, minFrames: -1 })).toBe(false);
  });

  it("requires drawElement to be enabled and ungated", () => {
    expect(shouldPreferSingleWorkerDrawElement({ ...eligible, useDrawElement: false })).toBe(false);
    expect(shouldPreferSingleWorkerDrawElement({ ...eligible, deCompileGate: "3d" })).toBe(false);
    expect(shouldPreferSingleWorkerDrawElement({ ...eligible, forceScreenshot: true })).toBe(false);
  });

  it("only applies to the benchmarked configuration (mp4 + streaming-eligible)", () => {
    expect(shouldPreferSingleWorkerDrawElement({ ...eligible, outputFormat: "webm" })).toBe(false);
    expect(
      shouldPreferSingleWorkerDrawElement({ ...eligible, singleWorkerStreamingOk: false }),
    ).toBe(false);
  });

  it("is a no-op when workers already resolved to 1", () => {
    expect(shouldPreferSingleWorkerDrawElement({ ...eligible, workerCount: 1 })).toBe(false);
  });
});

describe("resolveInversionRetryPlan (self-verify retry rollback)", () => {
  const cfg = { enableStreamingEncode: true, streamingEncodeMaxDurationSeconds: 240 };

  it("returns null when the render was never inverted", () => {
    expect(
      resolveInversionRetryPlan({
        deWorkerInversion: undefined,
        preInversionWorkerCount: 5,
        cfg,
        outputFormat: "mp4",
        durationSeconds: 80,
        isMemoryExhaustion: false,
      }),
    ).toBe(null);
    expect(
      resolveInversionRetryPlan({
        deWorkerInversion: "reverted",
        preInversionWorkerCount: 5,
        cfg,
        outputFormat: "mp4",
        durationSeconds: 80,
        isMemoryExhaustion: false,
      }),
    ).toBe(null);
  });

  it("restores the pre-inversion worker count and routes multi-worker retries to disk", () => {
    const plan = resolveInversionRetryPlan({
      deWorkerInversion: "inverted",
      preInversionWorkerCount: 5,
      cfg,
      outputFormat: "mp4",
      durationSeconds: 80,
      isMemoryExhaustion: false,
    });
    expect(plan).toEqual({
      workerCount: 5,
      // shouldUseStreamingEncode is workerCount===1-only — parallel retry
      // goes through the disk path.
      useStreamingEncode: false,
      deWorkerInversion: "reverted",
    });
  });

  it("keeps streaming when the pre-inversion resolution was already single-worker", () => {
    const plan = resolveInversionRetryPlan({
      deWorkerInversion: "inverted",
      preInversionWorkerCount: 1,
      cfg,
      outputFormat: "mp4",
      durationSeconds: 80,
      isMemoryExhaustion: false,
    });
    expect(plan).toEqual({
      workerCount: 1,
      useStreamingEncode: true,
      deWorkerInversion: "reverted",
    });
  });

  it("drops to a single worker on OOM regardless of the pre-inversion count (the actual memory remedy)", () => {
    const plan = resolveInversionRetryPlan({
      deWorkerInversion: "inverted",
      preInversionWorkerCount: 5,
      cfg,
      outputFormat: "mp4",
      durationSeconds: 80,
      isMemoryExhaustion: true,
    });
    expect(plan).toEqual({
      workerCount: 1,
      useStreamingEncode: true,
      deWorkerInversion: "reverted",
    });
  });
});

describe("isDeParallelRouterEnabled (kill switch parsing)", () => {
  it("defaults ON when unset or set-but-empty", () => {
    expect(isDeParallelRouterEnabled({})).toBe(true);
    expect(isDeParallelRouterEnabled({ HF_DE_PARALLEL_ROUTER: "" })).toBe(true);
    expect(isDeParallelRouterEnabled({ HF_DE_PARALLEL_ROUTER: "   " })).toBe(true);
  });

  it("honours every conventional spelling of off — an opt-out must never fail OPEN", () => {
    // A naive `!== "false"` would enable the router for all of these, handing
    // 3-worker parallel DE to a user who explicitly asked for none.
    for (const v of ["false", "FALSE", "False", "0", "off", "OFF", "no", "No", " false "]) {
      expect(isDeParallelRouterEnabled({ HF_DE_PARALLEL_ROUTER: v })).toBe(false);
    }
  });

  it("treats any other value as enabled", () => {
    expect(isDeParallelRouterEnabled({ HF_DE_PARALLEL_ROUTER: "true" })).toBe(true);
    expect(isDeParallelRouterEnabled({ HF_DE_PARALLEL_ROUTER: "1" })).toBe(true);
  });
});

describe("shouldPreferParallelDrawElement (DE parallel router)", () => {
  const eligible = {
    workerCount: 5,
    requestedWorkers: "auto" as const,
    useDrawElement: true,
    deCompileGate: undefined,
    forceScreenshot: false,
    outputFormat: "mp4" as const,
    totalFrames: 2381,
    minFrames: 2000,
    layeredOrEffectRoute: false,
    supersampling: false,
    probeDeGated: false,
    experimentalParallelDeOptIn: false,
    routerEnabled: true,
    parallelStreamingAvailable: true,
    totalMemoryMb: 32768,
    minMemoryMb: 24576,
  };

  it("routes an auto-resolved multi-worker render for an eligible long comp", () => {
    expect(shouldPreferParallelDrawElement(eligible)).toBe(true);
  });

  it("withholds the bet when parallel streaming can't run (e.g. over the duration cap)", () => {
    // The router pins workerCount to 3 and skips calibration to serve the
    // verified parallel DE STREAMING path. If streaming is off for this
    // render — the >240s duration cap is the common case — firing would pay
    // the whole cost of the pin for none of the benefit.
    expect(
      shouldPreferParallelDrawElement({ ...eligible, parallelStreamingAvailable: false }),
    ).toBe(false);
  });

  it("withholds the parallel bet below the RAM floor (16 GB black-slab report)", () => {
    expect(shouldPreferParallelDrawElement({ ...eligible, totalMemoryMb: 16384 })).toBe(false);
  });

  it("routes exactly at the RAM floor", () => {
    expect(shouldPreferParallelDrawElement({ ...eligible, totalMemoryMb: 24576 })).toBe(true);
  });

  it("minMemoryMb <= 0 disables the RAM guard", () => {
    expect(
      shouldPreferParallelDrawElement({ ...eligible, totalMemoryMb: 8192, minMemoryMb: 0 }),
    ).toBe(true);
  });

  it("is disabled by default (routerEnabled: false is the shipped default)", () => {
    expect(shouldPreferParallelDrawElement({ ...eligible, routerEnabled: false })).toBe(false);
  });

  it("honors explicitly requested workers", () => {
    expect(shouldPreferParallelDrawElement({ ...eligible, requestedWorkers: 3 })).toBe(false);
  });

  it("routes for requestedWorkers undefined — the value production actually passes for auto", () => {
    expect(shouldPreferParallelDrawElement({ ...eligible, requestedWorkers: undefined })).toBe(
      true,
    );
  });

  it("skips comps routed to layered/HDR/shader paths (drawElement never runs there)", () => {
    expect(shouldPreferParallelDrawElement({ ...eligible, layeredOrEffectRoute: true })).toBe(
      false,
    );
  });

  it("skips supersampled renders (engine init-time DE gate)", () => {
    expect(shouldPreferParallelDrawElement({ ...eligible, supersampling: true })).toBe(false);
  });

  it("skips when the probe session already shows DE gated out", () => {
    expect(shouldPreferParallelDrawElement({ ...eligible, probeDeGated: true })).toBe(false);
  });

  it("honors the explicit experimental parallel-DE opt-in (already parallel, router is a no-op)", () => {
    expect(
      shouldPreferParallelDrawElement({ ...eligible, experimentalParallelDeOptIn: true }),
    ).toBe(false);
  });

  it("skips below the amortization threshold (benchmark: real-work comps clear 1.25x at ~2,000+ frames)", () => {
    expect(shouldPreferParallelDrawElement({ ...eligible, totalFrames: 915 })).toBe(false);
    expect(shouldPreferParallelDrawElement({ ...eligible, totalFrames: 2000 })).toBe(true);
  });

  it("is disabled by minFrames <= 0 (HF_DE_PARALLEL_MIN_FRAMES=0 kill switch)", () => {
    expect(shouldPreferParallelDrawElement({ ...eligible, minFrames: 0 })).toBe(false);
    expect(shouldPreferParallelDrawElement({ ...eligible, minFrames: -1 })).toBe(false);
  });

  it("requires drawElement to be enabled and ungated", () => {
    expect(shouldPreferParallelDrawElement({ ...eligible, useDrawElement: false })).toBe(false);
    expect(shouldPreferParallelDrawElement({ ...eligible, deCompileGate: "3d" })).toBe(false);
    expect(shouldPreferParallelDrawElement({ ...eligible, forceScreenshot: true })).toBe(false);
  });

  it("only applies to mp4 (the benchmarked configuration)", () => {
    expect(shouldPreferParallelDrawElement({ ...eligible, outputFormat: "webm" })).toBe(false);
  });

  it("is a no-op when workers already resolved to 1", () => {
    expect(shouldPreferParallelDrawElement({ ...eligible, workerCount: 1 })).toBe(false);
  });
});

describe("resolveParallelRouterRetryPlan (self-verify retry rollback)", () => {
  const cfg = { enableStreamingEncode: true, streamingEncodeMaxDurationSeconds: 240 };

  it("returns null when the render was never router-routed", () => {
    expect(
      resolveParallelRouterRetryPlan({
        deParallelRouter: undefined,
        preRouterWorkerCount: 5,
        cfg,
        outputFormat: "mp4",
        durationSeconds: 80,
        isMemoryExhaustion: false,
      }),
    ).toBe(null);
    expect(
      resolveParallelRouterRetryPlan({
        deParallelRouter: "reverted",
        preRouterWorkerCount: 5,
        cfg,
        outputFormat: "mp4",
        durationSeconds: 80,
        isMemoryExhaustion: false,
      }),
    ).toBe(null);
  });

  it("restores the pre-router worker count and routes multi-worker retries to disk", () => {
    const plan = resolveParallelRouterRetryPlan({
      deParallelRouter: "routed",
      preRouterWorkerCount: 5,
      cfg,
      outputFormat: "mp4",
      durationSeconds: 80,
      isMemoryExhaustion: false,
    });
    expect(plan).toEqual({
      workerCount: 5,
      useStreamingEncode: false,
      deParallelRouter: "reverted",
    });
  });

  it("drops to a single worker on OOM regardless of the pre-router count (the actual memory remedy)", () => {
    const plan = resolveParallelRouterRetryPlan({
      deParallelRouter: "routed",
      preRouterWorkerCount: 5,
      cfg,
      outputFormat: "mp4",
      durationSeconds: 80,
      isMemoryExhaustion: true,
    });
    expect(plan).toEqual({
      workerCount: 1,
      useStreamingEncode: true,
      deParallelRouter: "reverted",
    });
  });
});

describe("shouldRetryViaPinnedFallback (widen the self-verify retry to generic capture failures, including OOM)", () => {
  it("always retries a drawElement self-verify failure, pinned or not", () => {
    expect(
      shouldRetryViaPinnedFallback({
        isVerifyError: true,
        isCancellation: false,
        deWorkerInversion: undefined,
        deParallelRouter: undefined,
      }),
    ).toBe(true);
  });

  it("retries a generic capture failure when the router pinned the worker count", () => {
    expect(
      shouldRetryViaPinnedFallback({
        isVerifyError: false,
        isCancellation: false,
        deWorkerInversion: undefined,
        deParallelRouter: "routed",
      }),
    ).toBe(true);
  });

  it("retries a generic capture failure when the inversion pinned the worker count", () => {
    expect(
      shouldRetryViaPinnedFallback({
        isVerifyError: false,
        isCancellation: false,
        deWorkerInversion: "inverted",
        deParallelRouter: undefined,
      }),
    ).toBe(true);
  });

  it("does not retry a generic capture failure when nothing pinned the worker count", () => {
    expect(
      shouldRetryViaPinnedFallback({
        isVerifyError: false,
        isCancellation: false,
        deWorkerInversion: undefined,
        deParallelRouter: undefined,
      }),
    ).toBe(false);
  });

  it("retries OOM too when the router pinned the worker count (fallback's Chrome processes are already dead by the time this runs, and the fallback is pooled/lighter than the pinned path)", () => {
    expect(
      shouldRetryViaPinnedFallback({
        isVerifyError: false,
        isCancellation: false,
        deWorkerInversion: undefined,
        deParallelRouter: "routed",
      }),
    ).toBe(true);
  });

  it("retries OOM too when the inversion pinned the worker count", () => {
    expect(
      shouldRetryViaPinnedFallback({
        isVerifyError: false,
        isCancellation: false,
        deWorkerInversion: "inverted",
        deParallelRouter: undefined,
      }),
    ).toBe(true);
  });

  it("does not retry a generic failure on an already-reverted cohort (no pin left to retreat from)", () => {
    expect(
      shouldRetryViaPinnedFallback({
        isVerifyError: false,
        isCancellation: false,
        deWorkerInversion: "reverted",
        deParallelRouter: undefined,
      }),
    ).toBe(false);
  });

  it("never retries a cancellation, even on a pinned cohort — must propagate immediately, not detour through a fresh encoder spin-up", () => {
    expect(
      shouldRetryViaPinnedFallback({
        isVerifyError: false,
        isCancellation: true,
        deWorkerInversion: "inverted",
        deParallelRouter: undefined,
      }),
    ).toBe(false);
    expect(
      shouldRetryViaPinnedFallback({
        isVerifyError: false,
        isCancellation: true,
        deWorkerInversion: undefined,
        deParallelRouter: "routed",
      }),
    ).toBe(false);
  });

  it("cancellation wins even if the error also looks like a self-verify failure", () => {
    expect(
      shouldRetryViaPinnedFallback({
        isVerifyError: true,
        isCancellation: true,
        deWorkerInversion: undefined,
        deParallelRouter: undefined,
      }),
    ).toBe(false);
  });

  it("never hides an encoder host interruption behind the same-host pinned fallback", () => {
    expect(
      shouldRetryViaPinnedFallback({
        isVerifyError: false,
        isCancellation: false,
        isEncoderInterrupted: true,
        deWorkerInversion: "inverted",
        deParallelRouter: undefined,
      }),
    ).toBe(false);
  });
});

describe("shouldStreamParallelCapture (non-DE parallel streaming router)", () => {
  const eligible = {
    routerEnabled: true,
    workerCount: 3,
    useDrawElement: false,
    outputFormat: "mp4" as const,
    streamingOk: true,
    layeredOrEffectRoute: false,
  };

  it("routes an eligible multi-worker non-drawElement render", () => {
    expect(shouldStreamParallelCapture(eligible)).toBe(true);
  });

  it("is disabled by default (kill switch off is the shipped default)", () => {
    expect(shouldStreamParallelCapture({ ...eligible, routerEnabled: false })).toBe(false);
  });

  it("never fires for single-worker renders (those already stream)", () => {
    expect(shouldStreamParallelCapture({ ...eligible, workerCount: 1 })).toBe(false);
  });

  it("never fires when drawElement will capture (the DE routers own that path)", () => {
    expect(shouldStreamParallelCapture({ ...eligible, useDrawElement: true })).toBe(false);
  });

  it("only applies to mp4", () => {
    expect(shouldStreamParallelCapture({ ...eligible, outputFormat: "webm" })).toBe(false);
    expect(shouldStreamParallelCapture({ ...eligible, outputFormat: "png-sequence" })).toBe(false);
  });

  it("respects the streaming-encode config/duration gates", () => {
    expect(shouldStreamParallelCapture({ ...eligible, streamingOk: false })).toBe(false);
  });

  it("skips HDR-layered and shader-transition routes", () => {
    expect(shouldStreamParallelCapture({ ...eligible, layeredOrEffectRoute: true })).toBe(false);
  });
});

describe("closeOrphanedProbeForRetry (probe cleanup before verify-triggered retry)", () => {
  // Enough of a CaptureSession stand-in to exercise the closer path — the
  // helper never inspects the object; it just hands it to the injected closer.
  const stubSession = { browserConsoleBuffer: [] } as unknown as Parameters<
    typeof closeOrphanedProbeForRetry
  >[0];

  it("hands the still-owned probe to the closer before the caller clears it", async () => {
    const closer = vi.fn(async () => {});
    const log = { warn: vi.fn() };

    await closeOrphanedProbeForRetry(stubSession, closer, log, "streaming");

    expect(closer).toHaveBeenCalledTimes(1);
    expect(closer).toHaveBeenCalledWith(stubSession);
    expect(log.warn).not.toHaveBeenCalled();
  });

  it("swallows a close failure with a warn so the caller's retry can proceed", async () => {
    const closer = vi.fn(async () => {
      throw new Error("chrome zombie");
    });
    const log = { warn: vi.fn() };

    await expect(
      closeOrphanedProbeForRetry(stubSession, closer, log, "disk verify"),
    ).resolves.toBeUndefined();

    expect(closer).toHaveBeenCalledTimes(1);
    expect(log.warn).toHaveBeenCalledTimes(1);
    const [message, meta] = log.warn.mock.calls[0];
    expect(message).toContain("disk verify");
    expect((meta as { error: string }).error).toBe("chrome zombie");
  });

  it("preserves the retry context in the warn message so the audit trail names which retry path leaked", async () => {
    const closer = vi.fn(async () => {
      throw new Error("session already closed");
    });
    const log = { warn: vi.fn() };

    await closeOrphanedProbeForRetry(stubSession, closer, log, "streaming");

    expect(log.warn.mock.calls[0][0]).toContain("streaming");
    expect(log.warn.mock.calls[0][0]).not.toContain("disk verify");
  });

  it("stringifies non-Error rejections so the log entry still names the cause", async () => {
    const closer = vi.fn(async () => Promise.reject("string-only rejection"));
    const log = { warn: vi.fn() };

    await closeOrphanedProbeForRetry(stubSession, closer, log, "streaming");

    expect(log.warn).toHaveBeenCalledTimes(1);
    expect((log.warn.mock.calls[0][1] as { error: string }).error).toBe("string-only rejection");
  });
});

// BeginFrame is Linux-only in both real entry points, but the observability
// field derived its mode from `forceScreenshot` alone. That mislabelled 30,625
// Windows renders as `beginframe` over 14 days — a fifth of the fast-capture
// dashboard's capture-mode data — for captures that were really screenshot.
describe("resolveObservedCaptureMode", () => {
  it("only ever reports beginframe on linux", () => {
    expect(resolveObservedCaptureMode(false, "linux")).toBe("beginframe");
    expect(resolveObservedCaptureMode(false, "win32")).toBe("screenshot");
    expect(resolveObservedCaptureMode(false, "darwin")).toBe("screenshot");
  });

  // The case the old code got right, kept so a future simplification back to
  // a bare boolean fails here rather than in production telemetry.
  it("reports screenshot whenever screenshot was forced, linux included", () => {
    expect(resolveObservedCaptureMode(true, "linux")).toBe("screenshot");
    expect(resolveObservedCaptureMode(true, "win32")).toBe("screenshot");
  });
});

// The blocker found in review: seeding `captureMode` at construction is not
// enough. `updateCaptureObservability` fires at 23 sites, and the post-compile
// `{ forceScreenshot }` patch runs on EVERY render — the old closure re-derived
// from `forceScreenshot` alone and put `beginframe` back before capture began,
// so both telemetry emits read the reverted value. These go through the closure
// rather than the helper, which is the only way to catch that.
describe("createCaptureObservabilityUpdater", () => {
  const seed = (platform: NodeJS.Platform, forceScreenshot: boolean) => {
    const observability = {
      forceScreenshot,
      captureMode: resolveObservedCaptureMode(forceScreenshot, platform),
      browserGpuMode: "hardware" as const,
    } as Parameters<typeof createCaptureObservabilityUpdater>[0];
    return { observability, update: createCaptureObservabilityUpdater(observability, platform) };
  };

  // The exact production case: Windows, hardware GPU, screenshot not forced.
  it("keeps screenshot on win32 across an unrelated patch", () => {
    const { observability, update } = seed("win32", false);
    expect(observability.captureMode).toBe("screenshot");
    update({ transientRetries: 1 });
    expect(observability.captureMode).toBe("screenshot");
  });

  // The unconditional post-compile patch — the one that guaranteed the revert.
  it("keeps screenshot on win32 when forceScreenshot is re-patched false", () => {
    const { observability, update } = seed("win32", false);
    update({ forceScreenshot: false });
    expect(observability.captureMode).toBe("screenshot");
  });

  // Linux must still be able to report beginframe, or the fix would have
  // silently disabled the field everywhere instead of correcting it.
  it("still reports beginframe on linux, and honours a later force", () => {
    const { observability, update } = seed("linux", false);
    expect(observability.captureMode).toBe("beginframe");
    update({ transientRetries: 2 });
    expect(observability.captureMode).toBe("beginframe");
    update({ forceScreenshot: true });
    expect(observability.captureMode).toBe("screenshot");
  });

  it("applies the patch itself, not only the derived mode", () => {
    const { observability, update } = seed("win32", false);
    update({ workerCount: 4 });
    expect(observability.workerCount).toBe(4);
  });
});
