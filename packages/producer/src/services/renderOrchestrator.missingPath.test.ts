import { afterEach, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveConfig } from "@hyperframes/engine";
import { createRenderJob, executeRenderJob } from "./renderOrchestrator.js";

// Entry: executeRenderJob. Capture setup fails on a frame whose cache entry another hand removed; the failure must
// say what was gone, read before the render removes its own folders.
const trace = vi.hoisted(() => ({ missing: "", probeThrows: false }));

vi.mock("@hyperframes/core/missing-path", async (importOriginal) => {
  const real = await importOriginal<typeof import("@hyperframes/core/missing-path")>();
  return {
    errnoMissingPathOf: (error: unknown) => {
      if (trace.probeThrows) throw new RangeError("Maximum call stack size exceeded");
      return real.errnoMissingPathOf(error);
    },
  };
});

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
  runAudioStage: async ({ workDir }: { workDir: string }) => ({
    audioOutputPath: join(workDir, "audio.wav"),
    hasAudio: false,
    audioProcessMs: 0,
  }),
}));
vi.mock("./render/captureCost.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./render/captureCost.js")>()),
  resolveRenderWorkerCount: () => {
    throw Object.assign(new Error(`ENOENT: no such file or directory, open '${trace.missing}'`), {
      code: "ENOENT",
      path: trace.missing,
    });
  },
}));

const dirs: string[] = [];
afterEach(() => {
  trace.probeThrows = false;
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function failingRender() {
  const root = mkdtempSync(join(tmpdir(), "hf-missing-render-"));
  dirs.push(root);
  writeFileSync(join(root, "index.html"), "<div></div>");
  const cacheRoot = join(root, "hyperframes-extract-cache-u");
  mkdirSync(cacheRoot);
  trace.missing = join(cacheRoot, "hfcache-v10-gone", "frame_00001.jpg");
  const job = createRenderJob({
    fps: 30,
    quality: "draft",
    format: "mp4",
    hdrMode: "force-sdr",
    producerConfig: resolveConfig({ enablePageSideCompositing: false }),
    logger: { info() {}, warn() {}, error() {}, debug() {} },
  });
  return { job, run: () => executeRenderJob(job, root, join(root, "out.mp4")) };
}

it("a render that fails on a missing frame says the cache entry holding it was gone", async () => {
  const { job, run } = failingRender();
  await expect(run()).rejects.toThrow(/ENOENT/);
  expect(job.errorDetails?.missingPath).toEqual({
    scope: "cache_entry",
    synced: false,
    root: "system_temp",
  });
});

it("a missing-path look that throws leaves the render's own failure as it was", async () => {
  trace.probeThrows = true;
  const { job, run } = failingRender();
  await expect(run()).rejects.toThrow(/ENOENT/);
  expect(job.status).toBe("failed");
  expect(job.error).toMatch(/ENOENT/);
  expect(job.errorDetails?.missingPath).toBeUndefined();
});
