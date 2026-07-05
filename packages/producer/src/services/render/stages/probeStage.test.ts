import { describe, expect, it, mock } from "bun:test";
import { hasAutoStartVideos, hasScriptedAudioVolumeAutomation } from "./probeStage.js";

// ── Mocks for runProbeStage tests ────────────────────────────────────────────
// Capture the cfg passed to createCaptureSession so we can assert it carries
// the correct forceScreenshot value (regression for #1236 — probe was launched
// in beginframe mode even when lowMemoryMode demanded screenshot capture).
const capturedCfgs: unknown[] = [];

const mockPage = {
  evaluate: async () => ({
    timelineKeys: [],
    hfDuration: 5,
    gsapLoaded: false,
    totalDurationMs: 5000,
    __hf: {},
  }),
};

let initializeSessionCallCount = 0;
let initializeSessionFailUntilAttempt = 0;
let initializeSessionError: Error | null = null;
let createSessionCallCount = 0;
let createSessionFailUntilAttempt = 0;
let createSessionError: Error | null = null;
let closeCaptureSessionCallCount = 0;

function resetRetryMocks() {
  initializeSessionCallCount = 0;
  initializeSessionFailUntilAttempt = 0;
  initializeSessionError = null;
  createSessionCallCount = 0;
  createSessionFailUntilAttempt = 0;
  createSessionError = null;
  closeCaptureSessionCallCount = 0;
}

mock.module("@hyperframes/engine", () => ({
  createCaptureSession: async (
    _url: string,
    _dir: string,
    _opts: unknown,
    _nullArg: unknown,
    cfg: unknown,
  ) => {
    createSessionCallCount++;
    capturedCfgs.push(cfg);
    if (createSessionError && createSessionCallCount <= createSessionFailUntilAttempt) {
      throw createSessionError;
    }
    return {
      isInitialized: false,
      browserConsoleBuffer: [],
      page: mockPage,
    };
  },
  initializeSession: async (session: { isInitialized: boolean }) => {
    initializeSessionCallCount++;
    if (initializeSessionError && initializeSessionCallCount <= initializeSessionFailUntilAttempt) {
      throw initializeSessionError;
    }
    session.isInitialized = true;
  },
  getCompositionDuration: async () => 5,
  closeCaptureSession: async () => {
    closeCaptureSessionCallCount++;
  },
  // Mirror of the real engine classifier. Canonical tests + pattern list
  // live in frameCapture-transientErrors.test.ts — update both if patterns change.
  isTransientBrowserError: (error: unknown) => {
    const msg = error instanceof Error ? error.message : String(error);
    if (/Composition has zero duration[\s\S]*Runtime ready: false/.test(msg)) return true;
    return /Navigating frame was detached|Target closed|Session closed|browser has disconnected|Page crashed|Execution context was destroyed|Cannot find context with specified id|Failed to launch the browser process|Navigation timeout of \d+ ms exceeded|ECONNREFUSED/i.test(
      msg,
    );
  },
}));

mock.module("../../fileServer.js", () => ({
  createFileServer: async () => ({
    url: "http://127.0.0.1:0",
    port: 0,
    close: () => {},
    addPreHeadScript: () => {},
  }),
  VIRTUAL_TIME_SHIM: "",
}));

mock.module("../../htmlCompiler.js", () => ({
  discoverMediaFromBrowser: async () => [],
  discoverAudioVolumeAutomationFromTimeline: async () => [],
  discoverVideoVisibilityFromTimeline: async () => [],
  recompileWithResolutions: async (c: unknown) => c,
  resolveCompositionDurations: async () => [],
}));

mock.module("../shared.js", () => ({
  BROWSER_MEDIA_EPSILON: 0.0001,
  projectBrowserEndToCompositionTimeline: () => 0,
  writeCompiledArtifacts: () => {},
}));

function makeProbeInput(overrides: {
  cfgForceScreenshot?: boolean;
  stageForceScreenshot?: boolean;
}) {
  const cfg = {
    forceScreenshot: overrides.cfgForceScreenshot ?? false,
    lowMemoryMode: false,
    // Minimal EngineConfig fields consumed by probeStage
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
    browserTimeout: 120_000,
    protocolTimeout: 300_000,
    enableChunkedEncode: false,
    chunkSizeFrames: 360,
    enableStreamingEncode: false,
    streamingEncodeMaxDurationSeconds: 240,
    ffmpegEncodeTimeout: 600_000,
    ffmpegProcessTimeout: 300_000,
    ffmpegStreamingTimeout: 600_000,
    hdr: false,
    hdrAutoDetect: true,
    audioGain: 1,
    frameDataUriCacheLimit: 256,
    frameDataUriCacheBytesLimitMb: 1500,
    playerReadyTimeout: 45_000,
    renderReadyTimeout: 15_000,
    verifyRuntime: true,
    debug: false,
  };

  return {
    projectDir: "/tmp/hf-probe-test-project",
    workDir: "/tmp/hf-probe-test-work",
    job: {
      id: "probe-test",
      config: { fps: { num: 30, den: 1 }, quality: "standard" },
      status: "queued",
      progress: 0,
      currentStage: "Probe",
      createdAt: new Date(0),
      duration: 0,
    },
    // composition.duration = 0 forces needsBrowser = true, triggering
    // the createCaptureSession call we want to inspect.
    composition: {
      duration: 0,
      videos: [],
      audios: [],
      images: [],
      width: 1920,
      height: 1080,
    },
    compiled: {
      html: "<html><body><div class='clip' data-duration='5'></div></body></html>",
      subCompositions: new Map(),
      videos: [],
      audios: [],
      images: [],
      unresolvedCompositions: [],
      externalAssets: new Map(),
      width: 1920,
      height: 1080,
      staticDuration: 5,
      renderModeHints: { recommendScreenshot: false, reasons: [] },
      hasShaderTransitions: false,
    },
    cfg,
    // This is the value the orchestrator/planner threads in after the
    // low-memory bump (or any other forceScreenshot override).
    forceScreenshot: overrides.stageForceScreenshot ?? false,
    width: 1920,
    height: 1080,
    needsAlpha: false,
    deviceScaleFactor: 1,
    log: {
      error: () => {},
      warn: () => {},
      info: () => {},
      debug: () => {},
    },
    assertNotAborted: () => {},
  };
}

describe("hasScriptedAudioVolumeAutomation", () => {
  it("ignores non-script volume text", () => {
    expect(
      hasScriptedAudioVolumeAutomation(
        `<style>.volume-control { opacity: 1; }</style><script>const level = 1;</script>`,
        1,
      ),
    ).toBe(false);
  });

  it("detects direct media volume writes", () => {
    expect(hasScriptedAudioVolumeAutomation(`<script>audio.volume = 0.5;</script>`, 1)).toBe(true);
  });

  it("detects GSAP volume tweens", () => {
    expect(
      hasScriptedAudioVolumeAutomation(`<script>gsap.to(audio, { volume: 1 });</script>`, 1),
    ).toBe(true);
  });

  it("parses script tags with whitespace before the closing bracket", () => {
    expect(hasScriptedAudioVolumeAutomation(`<script>audio.volume = 0.5;</script >`, 1)).toBe(true);
  });

  it("requires audio metadata", () => {
    expect(
      hasScriptedAudioVolumeAutomation(`<script>gsap.to(audio, { volume: 1 });</script>`, 0),
    ).toBe(false);
  });
});

describe("hasAutoStartVideos", () => {
  it("detects a real auto-start video element", () => {
    expect(hasAutoStartVideos(`<video src="a.mp4" data-hf-auto-start="">`)).toBe(true);
  });

  it("ignores the attribute mentioned in a comment (issue #1938)", () => {
    expect(hasAutoStartVideos(`<!-- videos get data-hf-auto-start injected --><p>hi</p>`)).toBe(
      false,
    );
  });

  it("ignores the attribute in prose text", () => {
    expect(hasAutoStartVideos(`<p>the data-hf-auto-start sentinel</p>`)).toBe(false);
  });

  it("returns false when there is no media", () => {
    expect(hasAutoStartVideos(`<div class="clip"></div>`)).toBe(false);
  });
});

describe("runProbeStage — forceScreenshot threading", () => {
  it("passes forceScreenshot:true to createCaptureSession when stage input carries it but cfg does not (low-memory mode fix #1236)", async () => {
    capturedCfgs.length = 0;

    const { runProbeStage } = await import("./probeStage.js");

    // Simulate renderOrchestrator / plan.ts after the low-memory bump:
    //   cfg.forceScreenshot = false  (compileStage resolved it without the bump)
    //   stage forceScreenshot = true (orchestrator detected lowMemoryMode and bumped)
    const input = makeProbeInput({ cfgForceScreenshot: false, stageForceScreenshot: true });

    await runProbeStage(input);

    expect(capturedCfgs.length).toBeGreaterThan(0);
    const capturedCfg = capturedCfgs[0] as { forceScreenshot: boolean };
    expect(capturedCfg.forceScreenshot).toBe(true);
    // Caller-owned cfg must not be mutated
    expect(input.cfg.forceScreenshot).toBe(false);
  });

  it("passes forceScreenshot:false through unchanged when neither cfg nor stage input forces it", async () => {
    capturedCfgs.length = 0;

    const { runProbeStage } = await import("./probeStage.js");

    const input = makeProbeInput({ cfgForceScreenshot: false, stageForceScreenshot: false });

    await runProbeStage(input);

    expect(capturedCfgs.length).toBeGreaterThan(0);
    const capturedCfg = capturedCfgs[0] as { forceScreenshot: boolean };
    expect(capturedCfg.forceScreenshot).toBe(false);
  });
});

describe("runProbeStage — transient browser error retry (#1687)", () => {
  it("retries once on a transient 'Navigating frame was detached' error and succeeds", async () => {
    resetRetryMocks();
    capturedCfgs.length = 0;
    initializeSessionError = new Error("Navigating frame was detached");
    initializeSessionFailUntilAttempt = 1;

    const { runProbeStage } = await import("./probeStage.js");
    const input = makeProbeInput({ cfgForceScreenshot: false, stageForceScreenshot: false });

    const result = await runProbeStage(input);

    expect(initializeSessionCallCount).toBe(2);
    expect(closeCaptureSessionCallCount).toBe(1);
    expect(result.duration).toBe(5);
    expect(result.probeSession).not.toBeNull();
  });

  it("retries once on a browser-probe navigation timeout and succeeds", async () => {
    resetRetryMocks();
    capturedCfgs.length = 0;
    initializeSessionError = new Error("Navigation timeout of 60000 ms exceeded");
    initializeSessionFailUntilAttempt = 1;

    const { runProbeStage } = await import("./probeStage.js");
    const input = makeProbeInput({ cfgForceScreenshot: false, stageForceScreenshot: false });

    const result = await runProbeStage(input);

    expect(initializeSessionCallCount).toBe(2);
    expect(closeCaptureSessionCallCount).toBe(1);
    expect(result.duration).toBe(5);
    expect(result.probeSession).not.toBeNull();
  });

  it("throws immediately on a non-transient error without retrying", async () => {
    resetRetryMocks();
    capturedCfgs.length = 0;
    initializeSessionError = new Error("FONT_FETCH_FAILED: Inter");
    initializeSessionFailUntilAttempt = 999;

    const { runProbeStage } = await import("./probeStage.js");
    const input = makeProbeInput({ cfgForceScreenshot: false, stageForceScreenshot: false });

    let caught: unknown;
    try {
      await runProbeStage(input);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toContain("FONT_FETCH_FAILED");
    expect(initializeSessionCallCount).toBe(1);
    expect(closeCaptureSessionCallCount).toBe(1);
  });

  it("throws after exhausting retry attempts on persistent transient errors", async () => {
    resetRetryMocks();
    capturedCfgs.length = 0;
    initializeSessionError = new Error("Target closed");
    initializeSessionFailUntilAttempt = 999;

    const { runProbeStage } = await import("./probeStage.js");
    const input = makeProbeInput({ cfgForceScreenshot: false, stageForceScreenshot: false });

    let caught: unknown;
    try {
      await runProbeStage(input);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toContain("Target closed");
    expect(initializeSessionCallCount).toBe(2);
    expect(closeCaptureSessionCallCount).toBe(2);
  });

  it("retries once on a pollHfReady zero-duration timeout (renderReady: false) and succeeds", async () => {
    resetRetryMocks();
    capturedCfgs.length = 0;
    initializeSessionError = new Error(
      "[FrameCapture] Composition has zero duration.\n  Runtime ready: false, __player: true, __hf.seek: true, GSAP timeline: true, data-duration: 53.3s",
    );
    initializeSessionFailUntilAttempt = 1;

    const { runProbeStage } = await import("./probeStage.js");
    const input = makeProbeInput({ cfgForceScreenshot: false, stageForceScreenshot: false });

    const result = await runProbeStage(input);

    expect(initializeSessionCallCount).toBe(2);
    expect(closeCaptureSessionCallCount).toBe(1);
    expect(result.duration).toBe(5);
    expect(result.probeSession).not.toBeNull();
  });

  it("throws immediately on a permanent zero-duration error (renderReady: true — genuine authoring bug)", async () => {
    resetRetryMocks();
    capturedCfgs.length = 0;
    initializeSessionError = new Error(
      "[FrameCapture] Composition has zero duration.\n  Runtime ready: true, __player: true, __hf.seek: true, GSAP timeline: false, data-duration: not set",
    );
    initializeSessionFailUntilAttempt = 999;

    const { runProbeStage } = await import("./probeStage.js");
    const input = makeProbeInput({ cfgForceScreenshot: false, stageForceScreenshot: false });

    let caught: unknown;
    try {
      await runProbeStage(input);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toContain("Runtime ready: true");
    expect(initializeSessionCallCount).toBe(1);
    expect(closeCaptureSessionCallCount).toBe(1);
  });

  it("retries on a transient browser LAUNCH failure (createCaptureSession throws)", async () => {
    resetRetryMocks();
    capturedCfgs.length = 0;
    createSessionError = new Error("Failed to launch the browser process!");
    createSessionFailUntilAttempt = 1;

    const { runProbeStage } = await import("./probeStage.js");
    const input = makeProbeInput({ cfgForceScreenshot: false, stageForceScreenshot: false });

    const result = await runProbeStage(input);

    expect(createSessionCallCount).toBe(2);
    expect(closeCaptureSessionCallCount).toBe(0);
    expect(result.duration).toBe(5);
    expect(result.probeSession).not.toBeNull();
  });
});
