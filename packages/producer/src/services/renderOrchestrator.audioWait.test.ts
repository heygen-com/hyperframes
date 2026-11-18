import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveConfig } from "@hyperframes/engine";
import { createRenderJob, executeRenderJob } from "./renderOrchestrator.js";

// Entry: executeRenderJob. The audio mix is held open past capture, so the steps after it wait on it; the test drives
// the mix's FFmpeg progress and reads the lines the render reports meanwhile.
const trace = vi.hoisted(() => ({
  ffmpegProgressed: (): void => {},
  failAudio: (_error: Error): void => {},
  setUp: false,
}));

vi.mock("@hyperframes/engine", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hyperframes/engine")>()),
  usableCpuCount: () => 8,
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
  runAudioStage: ({ onFfmpegProgress }: { onFfmpegProgress?: () => void }) =>
    new Promise((_resolve, reject) => {
      trace.ffmpegProgressed = onFfmpegProgress ?? (() => {});
      trace.failAudio = reject;
    }),
}));
vi.mock("./render/captureCost.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./render/captureCost.js")>()),
  resolveRenderWorkerCount: () => 1,
}));
/** Capture finishes while the mix still runs; the mix writes more meanwhile: not a line of its own yet. */
async function capturedWhileMixing() {
  trace.ffmpegProgressed();
  trace.setUp = true;
  return { success: true, workerCount: 1, probeSession: null, lastBrowserConsole: [], encodeMs: 0 };
}
vi.mock("./render/stages/captureStage.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./render/stages/captureStage.js")>()),
  runCaptureStage: capturedWhileMixing,
}));
vi.mock("./render/stages/captureStreamingStage.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./render/stages/captureStreamingStage.js")>()),
  runCaptureStreamingStage: capturedWhileMixing,
}));

const dirs: string[] = [];
afterEach(() => {
  vi.useRealTimers();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const turn = () => new Promise((resolve) => setImmediate(resolve));

it("says it is processing audio while the render waits on a mix whose FFmpeg writes more, at most every 5 s", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const root = mkdtempSync(join(tmpdir(), "hf-audio-wait-"));
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
  const lines: string[] = [];
  const render = executeRenderJob(job, root, join(root, "out.mp4"), (reported, stage) => {
    lines.push(`${reported.stageProgress?.code}:${stage}`);
  }).catch((error: unknown) => error);

  for (let at = 0; at < 5_000 && !trace.setUp; at++) await turn();
  expect(trace.setUp).toBe(true);
  const audioLines = () => lines.filter((line) => line === "process_audio:Processing audio tracks");
  await turn();
  // Only the stage's own first line.
  const before = audioLines().length;
  expect(before).toBe(1);
  // The mix writes more every 6 s until the render, now waiting on it, says so.
  for (let at = 0; at < 200 && audioLines().length === before; at++) {
    vi.setSystemTime(Date.now() + 6_000);
    trace.ffmpegProgressed();
    await turn();
  }
  expect(audioLines().length).toBe(before + 1);
  expect(lines.at(-1)).toBe("process_audio:Processing audio tracks");

  // Writing more within 5 s of that line says nothing new; after 5 s, one more line.
  vi.setSystemTime(Date.now() + 4_000);
  trace.ffmpegProgressed();
  await turn();
  expect(audioLines().length).toBe(before + 1);
  vi.setSystemTime(Date.now() + 1_000);
  trace.ffmpegProgressed();
  await turn();
  expect(audioLines().length).toBe(before + 2);

  vi.useRealTimers();
  trace.failAudio(new Error("stop after the wait"));
  expect(String(await render)).toContain("stop after the wait");
});
