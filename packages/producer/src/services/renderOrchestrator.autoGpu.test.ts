import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveConfig, type EngineConfig } from "@hyperframes/engine";
import {
  estimateMeasuredCaptureCostMultiplier,
  type CaptureCostEstimate,
} from "./render/captureCost.js";
import { createRenderJob, executeRenderJob } from "./renderOrchestrator.js";

// Entry: executeRenderJob in auto GPU mode with the probe resolving to hardware and calibration
// scripted per GPU mode. The capture stage records what it was given and ends the render there.
const { state, CAPTURE_REACHED } = vi.hoisted(() => ({
  state: {
    calibratedModes: [] as string[],
    captureGpuModes: [] as string[],
    sizedWith: [] as (number | undefined)[],
    hardwareP95Ms: 1678,
    softwareP95Ms: 90,
  },
  CAPTURE_REACHED: "capture reached",
}));

const estimate = (p95Ms: number): CaptureCostEstimate =>
  estimateMeasuredCaptureCostMultiplier(
    [0, 1, 2, 3, 4].map((frameIndex) => ({ frameIndex, captureTimeMs: p95Ms })),
  );

vi.mock("@hyperframes/engine", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hyperframes/engine")>()),
  assertConfiguredFfmpegBinariesExist: () => {},
  resolveBrowserGpuMode: async (mode: string) => (mode === "software" ? "software" : "hardware"),
  resolveHeadlessShellPath: () => "/opt/chrome-headless-shell",
  createCaptureSession: async () => ({ browserConsoleBuffer: [], options: {} }),
  initializeSession: async () => {},
  closeCaptureSession: async () => {},
}));
vi.mock("./fileServer.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./fileServer.js")>()),
  createFileServer: async () => ({
    url: "http://127.0.0.1:1",
    port: 1,
    close: () => {},
    addPreHeadScript: () => {},
  }),
}));
vi.mock("./render/stages/compileStage.js", () => ({
  runCompileStage: async () => ({
    compiled: {
      html: "<div></div>",
      renderModeHints: { reasons: [] },
      hasShaderTransitions: false,
      unresolvedCompositions: [],
    },
    composition: { width: 320, height: 180, duration: 4, videos: [], images: [], audios: [] },
    deviceScaleFactor: 1,
    outputWidth: 320,
    outputHeight: 180,
    compileOnlyMs: 0,
    forceScreenshot: true,
  }),
}));
vi.mock("./render/stages/probeStage.js", () => ({
  runProbeStage: async ({ compiled }: { compiled: object }) => ({
    compiled,
    fileServer: null,
    probeSession: null,
    lastBrowserConsole: [],
    duration: 4,
    totalFrames: 120,
    browserProbeMs: 0,
  }),
}));
vi.mock("./render/stages/extractVideosStage.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./render/stages/extractVideosStage.js")>()),
  runExtractVideosStage: async () => ({
    extractionResult: null,
    frameLookup: null,
    videoReadinessSkipIds: new Set<string>(),
    videoMetadataHints: new Map(),
    nativeHdrVideoIds: new Set<string>(),
    videoTransfers: new Map(),
    nativeHdrImageIds: new Set<string>(),
    imageTransfers: new Map(),
    hdrImageSrcPaths: new Map(),
    imageColorSpaces: [],
    videoExtractMs: 0,
    failureToEnforce: undefined,
  }),
}));
vi.mock("./render/stages/audioStage.js", () => ({
  runAudioStage: async () => ({ audioOutputPath: undefined, hasAudio: false, audioProcessMs: 0 }),
}));
vi.mock("./render/captureCost.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./render/captureCost.js")>()),
  resolveRenderWorkerCount: (
    _frames: number,
    _workers: number | undefined,
    _cfg: EngineConfig,
    _compiled: unknown,
    _log: unknown,
    measured?: CaptureCostEstimate,
  ) => {
    state.sizedWith.push(measured?.p95Ms);
    return 1;
  },
  runCaptureCalibration: async (input: {
    cfg: EngineConfig;
    forceScreenshot: boolean;
    probeSession: unknown;
  }) => {
    state.calibratedModes.push(input.cfg.browserGpuMode);
    const software = input.cfg.browserGpuMode === "software";
    return {
      calibration: {
        estimate: estimate(software ? state.softwareP95Ms : state.hardwareP95Ms),
        samples: [],
      },
      forceScreenshot: input.forceScreenshot,
      probeSession: input.probeSession,
      lastBrowserConsole: [],
      calibrationEvaluateTimedOut: false,
    };
  },
}));
vi.mock("./render/stages/captureStreamingStage.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./render/stages/captureStreamingStage.js")>()),
  runCaptureStreamingStage: async (input: { cfg: EngineConfig }) => {
    state.captureGpuModes.push(input.cfg.browserGpuMode);
    throw new Error(CAPTURE_REACHED);
  },
}));

const dirs: string[] = [];
beforeEach(() => {
  state.calibratedModes = [];
  state.captureGpuModes = [];
  state.sizedWith = [];
  state.hardwareP95Ms = 1678;
  state.softwareP95Ms = 90;
  vi.stubEnv("HF_SEGMENTED_CAPTURE", "false");
});
afterEach(() => {
  vi.unstubAllEnvs();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function render(browserGpuMode: EngineConfig["browserGpuMode"]): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "hf-auto-gpu-"));
  dirs.push(root);
  writeFileSync(join(root, "index.html"), "<div></div>");
  const job = createRenderJob({
    fps: 30,
    quality: "standard",
    hdrMode: "force-sdr",
    producerConfig: resolveConfig({ browserGpuMode, lowMemoryMode: false }),
    logger: { info() {}, warn() {}, error() {}, debug() {} },
  });
  return executeRenderJob(job, root, join(root, "output.mp4"));
}

it("captures in software, sized by the software calibration, when auto mode's hardware GPU calibrates slower", async () => {
  await expect(render("auto")).rejects.toThrow(CAPTURE_REACHED);
  expect(state.calibratedModes).toEqual(["auto", "software"]);
  expect(state.sizedWith).toEqual([90]);
  expect(state.captureGpuModes).toEqual(["software"]);
});

it("keeps the hardware GPU when software calibrates slower", async () => {
  state.softwareP95Ms = 2400;
  await expect(render("auto")).rejects.toThrow(CAPTURE_REACHED);
  expect(state.calibratedModes).toEqual(["auto", "software"]);
  expect(state.sizedWith).toEqual([1678]);
  expect(state.captureGpuModes).toEqual(["auto"]);
});

it("never times software for an explicit hardware request", async () => {
  await expect(render("hardware")).rejects.toThrow(CAPTURE_REACHED);
  expect(state.calibratedModes).toEqual(["hardware"]);
  expect(state.sizedWith).toEqual([1678]);
  expect(state.captureGpuModes).toEqual(["hardware"]);
});
