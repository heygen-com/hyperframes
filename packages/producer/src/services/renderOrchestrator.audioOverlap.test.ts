import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveConfig } from "@hyperframes/engine";
import { createRenderJob, executeRenderJob } from "./renderOrchestrator.js";

// Entry: executeRenderJob. The audio mix is held open; worker resolution (capture setup) records
// itself and then stops the render, so the test sees what ran while audio was still mixing.
const trace = vi.hoisted(() => ({ events: [] as string[], releaseAudio: () => {} }));

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
  runAudioStage: ({ workDir }: { workDir: string }) =>
    new Promise((resolve) => {
      trace.events.push("audio started");
      trace.releaseAudio = () => {
        trace.events.push("audio done");
        resolve({
          audioOutputPath: join(workDir, "audio.wav"),
          hasAudio: false,
          audioProcessMs: 0,
        });
      };
    }),
}));
vi.mock("./render/captureCost.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./render/captureCost.js")>()),
  resolveRenderWorkerCount: () => {
    trace.events.push("workers resolved");
    throw new Error("stop after capture setup");
  },
}));

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function until(condition: () => boolean): Promise<boolean> {
  for (let turn = 0; turn < 5_000 && !condition(); turn++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  return condition();
}

it("sets up capture while the audio mixes, and a failure waits for the mix", async () => {
  const root = mkdtempSync(join(tmpdir(), "hf-audio-overlap-"));
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
  let failure: unknown;
  const render = executeRenderJob(job, root, join(root, "frames")).catch((error: unknown) => {
    failure = error;
  });

  expect(await until(() => trace.events.includes("workers resolved"))).toBe(true);
  expect(trace.events).toEqual(["audio started", "workers resolved"]);
  await until(() => failure !== undefined);
  expect(failure).toBeUndefined();

  trace.releaseAudio();
  await render;
  expect(trace.events).toEqual(["audio started", "workers resolved", "audio done"]);
  expect(String(failure)).toContain("stop after capture setup");
});
