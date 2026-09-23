import { afterEach, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

vi.mock("@hyperframes/engine", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hyperframes/engine")>()),
  assertConfiguredFfmpegBinariesExist: () => {},
  resolveBrowserGpuMode: async () => "software",
  resolveHeadlessShellPath: () => process.execPath,
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
    composition: { width: 16, height: 16, duration: 1 / 30, videos: [], images: [], audios: [] },
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
    duration: 1 / 30,
    totalFrames: 1,
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

vi.mock("./render/stages/captureStage.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./render/stages/captureStage.js")>()),
  runCaptureStage: async () => ({
    workerCount: 1,
    probeSession: null,
    lastBrowserConsole: [],
  }),
}));

vi.mock("./render/stages/encodeStage.js", () => ({
  runEncodeStage: async ({ outputPath }: { outputPath: string }) => {
    mkdirSync(outputPath, { recursive: true });
    writeFileSync(join(outputPath, "frame_000001.png"), "new-render");
    return { encodeMs: 0 };
  },
}));

vi.mock("./render/perfSummary.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./render/perfSummary.js")>()),
  buildRenderPerfSummary: (..._args: unknown[]) => ({}),
}));

import { createRenderJob, executeRenderJob } from "./renderOrchestrator.js";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

it("executeRenderJob cannot publish when the final ancestor check cancels the render", async () => {
  const root = mkdtempSync(join(tmpdir(), "hf-render-final-cancel-"));
  dirs.push(root);
  writeFileSync(join(root, "index.html"), "<div></div>");
  const outputPath = join(root, "frames");
  mkdirSync(outputPath);
  writeFileSync(join(outputPath, "frame_000001.png"), "existing-render");
  const controller = new AbortController();
  const checkAncestors = vi.fn(() => controller.abort(new Error("parent-exited")));
  const job = createRenderJob({
    fps: 30,
    quality: "draft",
    format: "png-sequence",
    hdrMode: "force-sdr",
    workers: 1,
    logger: { info() {}, warn() {}, error() {}, debug() {} },
  });

  await expect(
    executeRenderJob(job, root, outputPath, undefined, controller.signal, checkAncestors),
  ).rejects.toThrow("render_cancelled");

  expect(checkAncestors).toHaveBeenCalledOnce();
  expect(readFileSync(join(outputPath, "frame_000001.png"), "utf8")).toBe("existing-render");
});
