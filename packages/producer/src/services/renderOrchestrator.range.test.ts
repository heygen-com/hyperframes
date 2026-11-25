import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveConfig } from "@hyperframes/engine";
import { createRenderJob, executeRenderJob, type RenderJob } from "./renderOrchestrator.js";

// Entry: executeRenderJob with a range on a 10 s, 300-frame film. Each capture stage records what
// it was given and ends the render there.
const { state, CAPTURE_REACHED } = vi.hoisted(() => ({
  state: {
    shaderTransitions: false,
    disk: [] as { totalFrames: number; frameRange?: { startFrame: number; endFrame: number } }[],
    streaming: 0,
    layered: [] as {
      totalFrames: number;
      frameWindow?: { startFrame: number; endFrame: number };
    }[],
    audio: [] as { totalFrames: number; frameWindow?: { startFrame: number; endFrame: number } }[],
  },
  CAPTURE_REACHED: "capture reached",
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
      hasShaderTransitions: state.shaderTransitions,
      unresolvedCompositions: [],
    },
    composition: { width: 320, height: 180, duration: 10, videos: [], images: [], audios: [] },
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
    duration: 10,
    totalFrames: 300,
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
  runAudioStage: async (input: {
    totalFrames: number;
    frameWindow?: { startFrame: number; endFrame: number };
  }) => {
    state.audio.push({ totalFrames: input.totalFrames, frameWindow: input.frameWindow });
    return { audioOutputPath: undefined, hasAudio: false, audioProcessMs: 0 };
  },
}));
vi.mock("./render/captureCost.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./render/captureCost.js")>()),
  resolveRenderWorkerCount: () => 1,
}));
vi.mock("./render/stages/captureStage.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./render/stages/captureStage.js")>()),
  runCaptureStage: async (input: {
    totalFrames: number;
    frameRange?: { startFrame: number; endFrame: number };
  }) => {
    state.disk.push({ totalFrames: input.totalFrames, frameRange: input.frameRange });
    throw new Error(CAPTURE_REACHED);
  },
}));
vi.mock("./render/stages/captureHdrStage.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./render/stages/captureHdrStage.js")>()),
  runCaptureHdrStage: async (input: {
    totalFrames: number;
    job: { frameWindow?: { startFrame: number; endFrame: number } };
  }) => {
    state.layered.push({ totalFrames: input.totalFrames, frameWindow: input.job.frameWindow });
    throw new Error(CAPTURE_REACHED);
  },
}));
vi.mock("./render/stages/captureStreamingStage.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./render/stages/captureStreamingStage.js")>()),
  runCaptureStreamingStage: async () => {
    state.streaming++;
    throw new Error(CAPTURE_REACHED);
  },
}));

const dirs: string[] = [];
beforeEach(() => {
  state.shaderTransitions = false;
  state.disk = [];
  state.streaming = 0;
  state.layered = [];
  state.audio = [];
});
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function render(
  range?: { startSeconds: number; endSeconds?: number },
  format: "mp4" | "webm" = "mp4",
): Promise<RenderJob> {
  const root = mkdtempSync(join(tmpdir(), "hf-range-"));
  dirs.push(root);
  writeFileSync(join(root, "index.html"), "<div></div>");
  const job = createRenderJob({
    fps: 30,
    quality: "standard",
    hdrMode: "force-sdr",
    format,
    ...(range && { range }),
    producerConfig: resolveConfig({ browserGpuMode: "software", lowMemoryMode: false }),
    logger: { info() {}, warn() {}, error() {}, debug() {} },
  });
  await executeRenderJob(job, root, join(root, `output.${format}`)).catch((error: Error) => {
    if (!error.message.includes(CAPTURE_REACHED)) throw error;
  });
  return job;
}

it("captures the range's frames on the disk route and cuts the whole film's audio to it", async () => {
  const job = await render({ startSeconds: 2.5, endSeconds: 4 });
  expect(job.frameWindow).toEqual({ startFrame: 75, endFrame: 120 });
  expect(job.totalFrames).toBe(45);
  expect(job.duration).toBe(1.5);
  expect(state.streaming).toBe(0);
  expect(state.disk).toEqual([{ totalFrames: 45, frameRange: { startFrame: 75, endFrame: 120 } }]);
  expect(state.audio).toEqual([
    { totalFrames: 300, frameWindow: { startFrame: 75, endFrame: 120 } },
  ]);
});

it("renders the whole film as before without a range", async () => {
  const job = await render();
  expect(job.frameWindow).toBeUndefined();
  expect(job.totalFrames).toBe(300);
  expect(state.audio).toEqual([{ totalFrames: 300, frameWindow: undefined }]);
  expect(state.disk.length + state.streaming).toBe(1);
  expect(state.disk[0]?.frameRange).toBeUndefined();
});

it("captures the range's frames on the layered route", async () => {
  // webm and mov composite shader transitions on the layered route; mp4 composites them in the page.
  state.shaderTransitions = true;
  await render({ startSeconds: 2.5, endSeconds: 4 }, "webm");
  expect(state.layered).toEqual([
    { totalFrames: 45, frameWindow: { startFrame: 75, endFrame: 120 } },
  ]);
  expect(state.disk).toEqual([]);
  expect(state.streaming).toBe(0);
});
