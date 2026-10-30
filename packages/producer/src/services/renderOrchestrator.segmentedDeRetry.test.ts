import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DrawElementCaptureError,
  DrawElementVerificationError,
  resolveConfig,
} from "@hyperframes/engine";
import { CaptureStageError } from "./render/captureStageError.js";
import { createRenderJob, executeRenderJob } from "./renderOrchestrator.js";

// Entry: executeRenderJob on the segmented route, with the segmented stage scripted per attempt.
// The second attempt always throws RETRY_REACHED, so a test ends there without running assembly.
const { state, RETRY_REACHED } = vi.hoisted(() => ({
  state: {
    attempts: [] as Array<{
      forceScreenshot: boolean;
      kind: string;
      probeSession: unknown;
      completedSegments: number;
      segmentDirEntries: string[];
    }>,
    failures: [] as unknown[],
    resumable: false,
    sessions: [] as object[],
    closed: [] as object[],
  },
  RETRY_REACHED: "segmented retry reached",
}));

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
    session.captureMode = "drawelement";
  },
  closeCaptureSession: async (session: object) => {
    state.closed.push(session);
  },
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
  resolveRenderWorkerCount: () => 1,
  runCaptureCalibration: async (input: { forceScreenshot: boolean; probeSession: unknown }) => ({
    calibration: undefined,
    forceScreenshot: input.forceScreenshot,
    probeSession: input.probeSession,
    lastBrowserConsole: [],
  }),
}));
// A previous run left segment 0 complete; validating it for real needs ffprobe on a real file.
vi.mock("./render/segmentManifest.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./render/segmentManifest.js")>();
  return {
    ...actual,
    readSegmentManifest: (dir: string) =>
      state.resumable
        ? { version: 1, planHash: "", totalFrames: 1200, segmentFrames: 600, completed: [] }
        : actual.readSegmentManifest(dir),
    validateCompletedSegments: async () => new Set(state.resumable ? [0] : []),
  };
});
vi.mock("./render/stages/captureSegmentedStage.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./render/stages/captureSegmentedStage.js")>()),
  runCaptureSegmentedStage: async (input: {
    plan: { kind: string; forceScreenshot: boolean };
    probeSession: unknown;
    completedSegments?: ReadonlySet<number>;
    segmentDir: string;
    onSegmentComplete?: (entry: {
      index: number;
      startFrame: number;
      endFrame: number;
      path: string;
      bytes: number;
    }) => void;
  }): Promise<never> => {
    state.attempts.push({
      forceScreenshot: input.plan.forceScreenshot,
      kind: input.plan.kind,
      probeSession: input.probeSession,
      completedSegments: input.completedSegments?.size ?? 0,
      segmentDirEntries: existsSync(input.segmentDir) ? readdirSync(input.segmentDir) : [],
    });
    const failure = state.failures.shift();
    if (failure === undefined) throw new Error(RETRY_REACHED);
    // A segment finished before the failing frame, as it would mid-render.
    mkdirSync(input.segmentDir, { recursive: true });
    const path = join(input.segmentDir, "segment_00000.mp4");
    writeFileSync(path, "drawElement segment");
    input.onSegmentComplete?.({ index: 0, startFrame: 0, endFrame: 600, path, bytes: 19 });
    throw new CaptureStageError({ cause: failure, browserConsole: [] });
  },
}));

const dirs: string[] = [];
beforeEach(() => {
  state.attempts = [];
  state.failures = [];
  state.sessions = [];
  state.closed = [];
  state.resumable = false;
  vi.stubEnv("HF_SEGMENTED_CAPTURE", "true");
  vi.stubEnv("PRODUCER_EXPERIMENTAL_FAST_CAPTURE", "");
  vi.stubEnv("HF_DE_PARALLEL_STREAM", "");
  vi.stubEnv("HF_DE_PARALLEL_ROUTER", "false");
  vi.stubEnv("HF_DE_PARALLEL_MIN_MEM_MB", "0");
  // These cases exercise the single-worker inversion, which is opt-in.
  vi.stubEnv("HF_DE_SINGLE_MIN_FRAMES", "900");
});
afterEach(() => {
  vi.unstubAllEnvs();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function render(resumeSegments = false): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "hf-segmented-de-retry-"));
  dirs.push(root);
  writeFileSync(join(root, "index.html"), "<div></div>");
  const job = createRenderJob({
    fps: 30,
    quality: "standard",
    hdrMode: "force-sdr",
    resumeSegments,
    producerConfig: resolveConfig({ useDrawElement: true, browserGpuMode: "hardware" }),
    logger: { info() {}, warn() {}, error() {}, debug() {} },
  });
  return executeRenderJob(job, root, join(root, "output.mp4"));
}

function stalledRenderer(): Error {
  const err = new Error("drawElement frame exceeded 5000ms (renderer stopped scheduling)");
  err.name = "DeFrameTimeoutError";
  return err;
}

it.each([
  ["a suspect small frame", () => new DrawElementCaptureError(640, "suspect small frame")],
  ["no cached paint record", () => new DrawElementCaptureError(640, "No cached paint record")],
  ["a stalled renderer", stalledRenderer],
  [
    "a failed self-verification",
    () => new DrawElementVerificationError("drawElement PSNR too low", { kind: "psnr" }),
  ],
])("retries the segmented stage once on a screenshot session after %s", async (_label, failure) => {
  state.failures = [failure()];
  await expect(render()).rejects.toThrow(RETRY_REACHED);
  expect(state.attempts.map(({ kind, forceScreenshot }) => ({ kind, forceScreenshot }))).toEqual([
    { kind: "sdr_segmented", forceScreenshot: false },
    { kind: "sdr_segmented", forceScreenshot: true },
  ]);
  const probe = state.attempts[0]?.probeSession;
  expect(probe).toBeTruthy();
  expect(state.closed).toContain(probe);
  expect(state.attempts[1]?.probeSession).toBeNull();
});

it("re-captures every segment, including resumed ones, after a drawElement failure", async () => {
  state.resumable = true;
  state.failures = [new DrawElementCaptureError(640, "suspect small frame")];
  await expect(render(true)).rejects.toThrow(RETRY_REACHED);
  expect(state.attempts.map((a) => a.completedSegments)).toEqual([1, 0]);
  expect(state.attempts[1]?.segmentDirEntries).toEqual([]);
});

it("does not retry a second drawElement failure", async () => {
  state.failures = [
    new DrawElementCaptureError(640, "suspect small frame"),
    new DrawElementCaptureError(700, "suspect small frame"),
  ];
  await expect(render()).rejects.toThrow("drawElement capture failed at frame 700");
  expect(state.attempts).toHaveLength(2);
});

it("does not retry a failure drawElement did not cause", async () => {
  state.failures = [new Error("ffmpeg exited with code 1")];
  await expect(render()).rejects.toThrow("ffmpeg exited with code 1");
  expect(state.attempts).toHaveLength(1);
});
