import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveConfig } from "@hyperframes/engine";
import { createRenderJob, executeRenderJob, RenderQualityError } from "./renderOrchestrator.js";
import { AUDIO_STAGE } from "./render/shared.js";

// Entry: executeRenderJob. The audio mix is held open; every capture stage records that it started, then waits for the
// test or for the render's signal, so the test sees whether frames are drawn while the mix runs and what stops them.
const trace = vi.hoisted(() => ({
  events: [] as string[],
  finishAudio: (_result: object): void => {},
  failAudio: (_error: Error): void => {},
  finishCapture: (): void => {},
  cpus: 8,
}));

vi.mock("@hyperframes/engine", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hyperframes/engine")>()),
  usableCpuCount: () => trace.cpus,
}));

vi.mock("./render/shared.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./render/shared.js")>()),
  createMemorySampler: () => ({
    peakRssBytes: () => 0,
    peakHeapUsedBytes: () => 0,
    stop: () => {},
  }),
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
      hasShaderTransitions: false,
      renderModeHints: { reasons: [] },
    },
    composition: { width: 16, height: 16, duration: 40 / 30, videos: [], images: [], audios: [] },
    deviceScaleFactor: 1,
    outputWidth: 16,
    outputHeight: 16,
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
    duration: 40 / 30,
    totalFrames: 40,
    browserProbeMs: 0,
    beginFrameStalled: false,
  }),
}));
vi.mock("./render/stages/extractVideosStage.js", () => ({
  runExtractVideosStage: async () => ({
    extractionResult: null,
    frameLookup: null,
    videoReadinessSkipIds: [],
    videoMetadataHints: [],
    nativeHdrVideoIds: new Set(),
    videoTransfers: new Map(),
    nativeHdrImageIds: new Set(),
    imageTransfers: new Map(),
    hdrImageSrcPaths: new Map(),
    imageColorSpaces: [],
    videoExtractMs: 0,
    failureToEnforce: null,
  }),
}));
vi.mock("./render/stages/audioStage.js", () => ({
  runAudioStage: () =>
    new Promise((resolve, reject) => {
      trace.events.push("audio started");
      trace.finishAudio = (result) => {
        trace.events.push("audio done");
        resolve(result);
      };
      trace.failAudio = reject;
    }),
}));
vi.mock("./render/captureCost.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./render/captureCost.js")>()),
  resolveRenderWorkerCount: () => 1,
}));

/** Started, then held until the test finishes it (it then stops the render) or the render's signal aborts it. */
function heldCapture({ abortSignal }: { abortSignal?: AbortSignal }): Promise<never> {
  trace.events.push("capture started");
  return new Promise((_resolve, reject) => {
    trace.finishCapture = () => reject(new Error("stop after capture"));
    abortSignal?.addEventListener("abort", () => {
      trace.events.push("capture aborted");
      reject(abortSignal.reason);
    });
  });
}
vi.mock("./render/stages/captureStage.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./render/stages/captureStage.js")>()),
  runCaptureStage: heldCapture,
}));
vi.mock("./render/stages/captureStreamingStage.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./render/stages/captureStreamingStage.js")>()),
  runCaptureStreamingStage: heldCapture,
}));
vi.mock("./render/stages/captureSegmentedStage.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./render/stages/captureSegmentedStage.js")>()),
  runCaptureSegmentedStage: heldCapture,
}));

const dirs: string[] = [];
afterEach(() => {
  trace.events.length = 0;
  trace.cpus = 8;
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function until(condition: () => boolean): Promise<boolean> {
  for (let turn = 0; turn < 5_000 && !condition(); turn++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  return condition();
}

function startRender() {
  const root = mkdtempSync(join(tmpdir(), "hf-capture-during-audio-"));
  dirs.push(root);
  writeFileSync(join(root, "index.html"), "<div></div>");
  const job = createRenderJob({
    fps: 30,
    quality: "draft",
    format: "mp4",
    hdrMode: "force-sdr",
    producerConfig: resolveConfig({ enablePageSideCompositing: false }),
    logger: { info() {}, warn() {}, error() {}, debug() {} },
  });
  const failure = executeRenderJob(job, root, join(root, "out.mp4")).then(
    () => undefined,
    (error: unknown) => error,
  );
  return { job, root, failure };
}

it("draws frames while the audio still mixes", async () => {
  const { root, failure } = startRender();

  expect(await until(() => trace.events.includes("capture started"))).toBe(true);
  expect(trace.events).toEqual(["audio started", "capture started"]);

  trace.finishAudio({
    audioOutputPath: join(root, "audio.wav"),
    hasAudio: false,
    audioProcessMs: 0,
  });
  trace.finishCapture();
  expect(String(await failure)).toContain("stop after capture");
});

it("an audio mix that fails while frames are drawn stops them and fails the render with the mix's message", async () => {
  const { job, root, failure } = startRender();
  expect(await until(() => trace.events.includes("capture started"))).toBe(true);

  trace.finishAudio({
    audioOutputPath: join(root, "audio.wav"),
    hasAudio: false,
    audioProcessMs: 0,
    audioError: "the music track could not be read",
    audioFailures: [],
  });
  const error = await failure;

  expect(trace.events).toContain("capture aborted");
  expect(error).toBeInstanceOf(RenderQualityError);
  expect(String(error)).toContain(
    "Audio mix failed; output would be video-only: the music track could not be read",
  );
  expect(job.status).not.toBe("cancelled");
  expect(job.failedStage).toBe(AUDIO_STAGE);
});

it("an audio stage that throws while frames are drawn stops them and fails the render with its error", async () => {
  const { job, failure } = startRender();
  expect(await until(() => trace.events.includes("capture started"))).toBe(true);

  trace.failAudio(new Error("the mix's FFmpeg exited with code 1"));
  const error = await failure;

  expect(trace.events).toContain("capture aborted");
  expect(String(error)).toContain("the mix's FFmpeg exited with code 1");
  expect(job.status).not.toBe("cancelled");
  expect(job.failedStage).toBe(AUDIO_STAGE);
});

it("on fewer than 4 CPUs draws frames only after the mix", async () => {
  trace.cpus = 2;
  const { root, failure } = startRender();
  expect(await until(() => trace.events.includes("audio started"))).toBe(true);
  expect(await until(() => trace.events.includes("capture started"))).toBe(false);

  trace.finishAudio({
    audioOutputPath: join(root, "audio.wav"),
    hasAudio: false,
    audioProcessMs: 0,
  });
  expect(await until(() => trace.events.includes("capture started"))).toBe(true);
  expect(trace.events).toEqual(["audio started", "audio done", "capture started"]);
  trace.finishCapture();
  expect(String(await failure)).toContain("stop after capture");
});
