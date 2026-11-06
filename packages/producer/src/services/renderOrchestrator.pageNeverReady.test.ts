import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type CaptureOptions, resolveConfig } from "@hyperframes/engine";
import { CaptureStageError } from "./render/captureStageError.js";
import { extractSafeRenderErrorMetadata } from "../server.js";
import { createRenderJob, executeRenderJob } from "./renderOrchestrator.js";

// Entry: executeRenderJob on the streaming route; calibration and the streaming stage are scripted.
const { state } = vi.hoisted(() => ({
  state: { calibrationEvaluateTimedOut: false, framesBeforeFailure: 0, effectScanRan: false },
}));

vi.mock("@hyperframes/engine", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hyperframes/engine")>()),
  assertConfiguredFfmpegBinariesExist: () => {},
  resolveBrowserGpuMode: async () => "software",
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
    forceScreenshot: false,
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
  resolveRenderWorkerCount: () => 1,
  runCaptureCalibration: async (input: { forceScreenshot: boolean; probeSession: unknown }) => ({
    calibration: undefined,
    forceScreenshot: input.forceScreenshot,
    probeSession: input.probeSession,
    lastBrowserConsole: [],
    calibrationEvaluateTimedOut: state.calibrationEvaluateTimedOut,
  }),
}));
vi.mock("./render/stages/captureStreamingStage.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./render/stages/captureStreamingStage.js")>()),
  runCaptureStreamingStage: async (input: {
    job: { framesRendered?: number };
    buildCaptureOptions: () => CaptureOptions;
  }) => {
    input.job.framesRendered = state.framesBeforeFailure;
    if (state.effectScanRan) {
      const options = input.buildCaptureOptions();
      options.onEffectScanProgress?.(240, 240);
      options.onEffectScanEnd?.();
    }
    throw new CaptureStageError({ cause: new Error(EVALUATE_TIMEOUT), browserConsole: [] });
  },
}));

const EVALUATE_TIMEOUT = "Runtime.evaluate timed out. Increase the 'protocolTimeout' setting";

const dirs: string[] = [];
beforeEach(() => {
  state.calibrationEvaluateTimedOut = false;
  state.framesBeforeFailure = 0;
  state.effectScanRan = false;
  vi.stubEnv("HF_SEGMENTED_CAPTURE", "false");
});
afterEach(() => {
  vi.unstubAllEnvs();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function render(config: { lowMemoryMode?: boolean } = {}): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "hf-page-never-ready-"));
  dirs.push(root);
  writeFileSync(join(root, "index.html"), "<div></div>");
  const job = createRenderJob({
    fps: 30,
    quality: "standard",
    hdrMode: "force-sdr",
    producerConfig: {
      ...resolveConfig({ forceScreenshot: true, browserGpuMode: "software" }),
      ...config,
    },
    logger: { info() {}, warn() {}, error() {}, debug() {} },
  });
  lastJob = job;
  return executeRenderJob(job, root, join(root, "output.mp4"));
}

let lastJob: ReturnType<typeof createRenderJob>;

it("names frame capture as the failed stage for a failure after the effect scan, before frame one", async () => {
  state.effectScanRan = true;
  await render().catch(() => undefined);
  expect(lastJob.failedStage).toBe("Starting frame capture");
});

it.each([
  ["after calibration", {}],
  ["with no calibration, straight after the GPU check", { lowMemoryMode: true }],
])(
  "names frame capture as the failed stage for a failure before frame one, %s",
  async (_, config) => {
    await render(config).catch(() => undefined);
    expect(lastJob.failedStage).toBe("Starting frame capture");
  },
);

it("fails once as non-retryable when calibration and capture both timed out with no frame", async () => {
  state.calibrationEvaluateTimedOut = true;
  const error = await render().then(
    () => undefined,
    (caught: unknown) => caught,
  );
  expect(error).toMatchObject({ code: "PAGE_NEVER_READY", owner: "user", retryable: false });
  expect(extractSafeRenderErrorMetadata(error)).toMatchObject({
    errorCode: "PAGE_NEVER_READY",
    retryable: false,
  });
  expect((error as Error).message).toContain("never became ready");
});

it("keeps the original error when calibration did not time out", async () => {
  await expect(render()).rejects.toThrow(EVALUATE_TIMEOUT);
});

it("keeps the original error once a frame was captured", async () => {
  state.calibrationEvaluateTimedOut = true;
  state.framesBeforeFailure = 3;
  await expect(render()).rejects.toThrow(EVALUATE_TIMEOUT);
});
