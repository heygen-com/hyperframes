import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveConfig } from "@hyperframes/engine";
import { createRenderJob, executeRenderJob } from "./renderOrchestrator.js";

// Entry: executeRenderJob, with a composition the browser probe stage skips (static
// duration, no media), so no session has run the engine's drawElement gates yet.
const { RESOLVER_WORKERS, state, captureReached } = vi.hoisted(() => {
  const state = {
    probeCaptureMode: "screenshot",
    probeGateReason: undefined as string | undefined,
    sessions: [] as object[],
    calibrations: 0,
    firstCapture: undefined as { workerCount: number; probeSession: unknown } | undefined,
  };
  const captureReached = async (input: {
    plan: { workerCount: number };
    probeSession: unknown;
  }): Promise<never> => {
    state.firstCapture ??= {
      workerCount: input.plan.workerCount,
      probeSession: input.probeSession,
    };
    throw new Error("capture reached");
  };
  return { RESOLVER_WORKERS: 4, state, captureReached };
});

vi.mock("@hyperframes/engine", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hyperframes/engine")>()),
  assertConfiguredFfmpegBinariesExist: () => {},
  resolveBrowserGpuMode: async () => "hardware",
  createCaptureSession: async () => {
    const session = { browserConsoleBuffer: [], options: {}, isInitialized: false };
    state.sessions.push(session);
    return session;
  },
  initializeSession: async (session: Record<string, unknown>) => {
    session.isInitialized = true;
    session.captureMode = state.probeCaptureMode;
    session.deGateReason = state.probeGateReason;
  },
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
    composition: { width: 320, height: 180, duration: 40, videos: [], images: [], audios: [] },
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
    duration: 40,
    totalFrames: 1200,
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
  resolveRenderWorkerCount: () => RESOLVER_WORKERS,
  runCaptureCalibration: async (input: { forceScreenshot: boolean; probeSession: unknown }) => {
    state.calibrations += 1;
    return {
      calibration: undefined,
      forceScreenshot: input.forceScreenshot,
      probeSession: input.probeSession,
      lastBrowserConsole: [],
    };
  },
}));
vi.mock("./render/stages/captureStage.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./render/stages/captureStage.js")>()),
  runCaptureStage: captureReached,
}));
vi.mock("./render/stages/captureStreamingStage.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./render/stages/captureStreamingStage.js")>()),
  runCaptureStreamingStage: captureReached,
}));

const dirs: string[] = [];
beforeEach(() => {
  state.sessions = [];
  state.calibrations = 0;
  state.firstCapture = undefined;
  vi.stubEnv("PRODUCER_EXPERIMENTAL_FAST_CAPTURE", "");
  vi.stubEnv("HF_DE_PARALLEL_STREAM", "");
  vi.stubEnv("HF_DE_PARALLEL_MIN_MEM_MB", "0");
});
afterEach(() => {
  vi.unstubAllEnvs();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function renderUntilCapture(): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "hf-de-gate-probe-"));
  dirs.push(root);
  writeFileSync(join(root, "index.html"), "<div></div>");
  const job = createRenderJob({
    fps: 30,
    quality: "standard",
    hdrMode: "force-sdr",
    producerConfig: resolveConfig({ useDrawElement: true, browserGpuMode: "hardware" }),
    logger: { info() {}, warn() {}, error() {}, debug() {} },
  });
  await expect(executeRenderJob(job, root, join(root, "output.mp4"))).rejects.toThrow();
}

it.each([
  ["single-worker inversion", "false"],
  ["parallel router", "true"],
])(
  "a comp the engine refuses at init keeps the resolver's workers, not the %s",
  async (_route, router) => {
    vi.stubEnv("HF_DE_PARALLEL_ROUTER", router);
    state.probeCaptureMode = "screenshot";
    state.probeGateReason = "css_effect:filter";
    await renderUntilCapture();
    expect(state.firstCapture?.workerCount).toBe(RESOLVER_WORKERS);
    expect(state.calibrations).toBe(1);
    expect(state.sessions).toHaveLength(1);
  },
);

it("a comp drawElement accepts still inverts, and capture reuses the gate-check session", async () => {
  vi.stubEnv("HF_DE_PARALLEL_ROUTER", "false");
  state.probeCaptureMode = "drawelement";
  state.probeGateReason = undefined;
  await renderUntilCapture();
  expect(state.firstCapture?.workerCount).toBe(1);
  expect(state.calibrations).toBe(0);
  expect(state.firstCapture?.probeSession).toBe(state.sessions[0]);
});
