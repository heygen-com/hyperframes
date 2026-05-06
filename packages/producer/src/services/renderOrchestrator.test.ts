import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, win32 } from "node:path";
import { tmpdir } from "node:os";
import type { EngineConfig, ExtractedFrames } from "@hyperframes/engine";
import type { CompiledComposition } from "./htmlCompiler.js";

import {
  applyRenderModeHints,
  buildMissingFrameRetryBatches,
  collectVideoMetadataHints,
  collectVideoReadinessSkipIds,
  createCaptureCalibrationConfig,
  createCompiledFrameSrcResolver,
  estimateMeasuredCaptureCostMultiplier,
  estimateCaptureCostMultiplier,
  extractStandaloneEntryFromIndex,
  findMissingFrameRanges,
  getNextRetryWorkerCount,
  isRecoverableParallelCaptureError,
  materializeExtractedFramesForCompiledDir,
  projectBrowserEndToCompositionTimeline,
  resolveRenderWorkerCount,
  resolveCompositeTransfer,
  selectCaptureCalibrationFrames,
  shouldFallbackToScreenshotAfterCalibrationError,
  shouldUseLayeredComposite,
  shouldUseStreamingEncode,
  writeCompiledArtifacts,
} from "./renderOrchestrator.js";
import { toExternalAssetKey } from "../utils/paths.js";

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
});

describe("shouldUseStreamingEncode", () => {
  const streamingEnabledConfig = {
    enableStreamingEncode: true,
    streamingEncodeMaxDurationSeconds: 240,
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
      },
    });

    expect(extracted.outputDir).toBe(outputDir);
    expect(extracted.framePaths.get(0)).toBe(framePath);
  });

  it("remaps Windows cache frames under compiledDir using only the frame basename", () => {
    const compiledDir = win32.resolve("C:\\compiled");
    const outputDir = win32.resolve("D:\\cache\\abc123");
    const framePath = win32.join(outputDir, "frame_000001.jpg");
    const extracted = createExtractedFrames(outputDir, framePath);
    const symlinks: Array<{ target: string; path: string }> = [];

    materializeExtractedFramesForCompiledDir([extracted], compiledDir, {
      pathModule: win32,
      fileSystem: {
        existsSync: () => false,
        mkdirSync: () => undefined,
        symlinkSync: (target, path) => {
          symlinks.push({ target, path });
        },
      },
    });

    const linkPath = win32.join(compiledDir, "__hyperframes_video_frames", "video-1");
    expect(extracted.outputDir).toBe(linkPath);
    expect(extracted.framePaths.get(0)).toBe(win32.join(linkPath, "frame_000001.jpg"));
    expect(extracted.framePaths.get(0)).not.toContain(outputDir);
    expect(symlinks).toEqual([{ target: outputDir, path: linkPath }]);
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
    const workDir = makeWorkDir();
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

    const escapeTarget = join(workDir, "..", "..", "etc", "passwd");
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
    playerReadyTimeout: 45000,
    renderReadyTimeout: 15000,
    verifyRuntime: true,
    debug: false,
  };
}

describe("applyRenderModeHints", () => {
  it("forces screenshot mode when compatibility hints recommend it", () => {
    const cfg = createConfig();
    const compiled = createCompiledComposition(["iframe", "requestAnimationFrame"]);
    const log = {
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
    };

    applyRenderModeHints(cfg, compiled, log);

    expect(cfg.forceScreenshot).toBe(true);
    expect(log.warn).toHaveBeenCalledOnce();
  });

  it("does nothing when screenshot mode is already forced", () => {
    const cfg = createConfig();
    cfg.forceScreenshot = true;
    const compiled = createCompiledComposition(["iframe"]);
    const log = {
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
    };

    applyRenderModeHints(cfg, compiled, log);

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

  it("keeps baseline auto workers after screenshot fallback when measured capture is cheap", () => {
    const log = {
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
    };

    const workers = resolveRenderWorkerCount(
      180,
      undefined,
      { ...cfg, forceScreenshot: true },
      {
        hasShaderTransitions: false,
        renderModeHints: { recommendScreenshot: false, reasons: [] },
      },
      log,
      { multiplier: 1, reasons: [], p95Ms: 180 },
    );

    expect(workers).toBe(6);
    expect(log.warn).not.toHaveBeenCalled();
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
  it("uses a bounded protocol timeout for calibration probes", () => {
    const cfg = createConfig();
    const calibrationCfg = createCaptureCalibrationConfig(cfg);

    expect(calibrationCfg.protocolTimeout).toBe(30000);
    expect(cfg.protocolTimeout).toBe(300000);
  });

  it("preserves smaller explicit protocol timeouts for calibration probes", () => {
    const cfg = createConfig();
    cfg.protocolTimeout = 5000;

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
      writeFileSync(join(framesDir, `frame_${String(frameIndex).padStart(6, "0")}.jpg`), "x");
    }

    expect(findMissingFrameRanges(6, framesDir, "jpg")).toEqual([
      { startFrame: 2, endFrame: 4 },
      { startFrame: 5, endFrame: 6 },
    ]);
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
