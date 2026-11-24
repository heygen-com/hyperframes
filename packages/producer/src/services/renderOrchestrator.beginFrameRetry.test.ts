import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveConfig } from "@hyperframes/engine";
import { CaptureStageError } from "./render/captureStageError.js";
import { createRenderJob, executeRenderJob } from "./renderOrchestrator.js";

// Entry: executeRenderJob on the streaming route, with the streaming stage scripted per attempt.
// An attempt with no scripted failure throws RETRY_REACHED, so a test ends there without running assembly.
const { state, RETRY_REACHED } = vi.hoisted(() => ({
  state: {
    attempts: [] as boolean[],
    failures: [] as unknown[],
    compileForcesScreenshot: false,
  },
  RETRY_REACHED: "streaming retry reached",
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
    forceScreenshot: state.compileForcesScreenshot,
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
  }),
}));
vi.mock("./render/stages/captureStreamingStage.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./render/stages/captureStreamingStage.js")>()),
  runCaptureStreamingStage: async (input: { plan: { forceScreenshot: boolean } }) => {
    state.attempts.push(input.plan.forceScreenshot);
    const failure = state.failures.shift();
    if (failure === undefined) throw new Error(RETRY_REACHED);
    throw new CaptureStageError({ cause: failure, browserConsole: [] });
  },
}));

const platform = Object.getOwnPropertyDescriptor(process, "platform");
const dirs: string[] = [];
beforeEach(() => {
  state.attempts = [];
  state.failures = [];
  state.compileForcesScreenshot = false;
  Object.defineProperty(process, "platform", { value: "linux" });
  vi.stubEnv("HF_SEGMENTED_CAPTURE", "false");
});
afterEach(() => {
  if (platform) Object.defineProperty(process, "platform", platform);
  vi.unstubAllEnvs();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function render(): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "hf-beginframe-retry-"));
  dirs.push(root);
  writeFileSync(join(root, "index.html"), "<div></div>");
  const job = createRenderJob({
    fps: 30,
    quality: "standard",
    hdrMode: "force-sdr",
    producerConfig: resolveConfig({ forceScreenshot: false, browserGpuMode: "software" }),
    logger: { info() {}, warn() {}, error() {}, debug() {} },
  });
  return executeRenderJob(job, root, join(root, "output.mp4"));
}

const beginFrameOnlyFailure = () =>
  new Error("Runtime.callFunctionOn timed out while drawing frame 37");

it("re-renders a BeginFrame attempt that failed for any capture reason on a screenshot session", async () => {
  state.failures = [beginFrameOnlyFailure()];
  await expect(render()).rejects.toThrow(RETRY_REACHED);
  expect(state.attempts).toEqual([false, true]);
});

it("does not retry when the failed attempt already captured in screenshot mode", async () => {
  state.compileForcesScreenshot = true;
  state.failures = [beginFrameOnlyFailure()];
  await expect(render()).rejects.toThrow("Runtime.callFunctionOn timed out");
  expect(state.attempts).toEqual([true]);
});

it("does not retry a second failure after the screenshot re-render", async () => {
  state.failures = [beginFrameOnlyFailure(), new Error("Runtime.callFunctionOn timed out again")];
  await expect(render()).rejects.toThrow("timed out again");
  expect(state.attempts).toEqual([false, true]);
});
