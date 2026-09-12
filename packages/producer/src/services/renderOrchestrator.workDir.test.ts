import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveConfig } from "@hyperframes/engine";
import { createRenderJob, executeRenderJob } from "./renderOrchestrator.js";
import { runCompileStage } from "./render/stages/compileStage.js";
import { runCaptureStreamingStage } from "./render/stages/captureStreamingStage.js";
import { runCaptureStage } from "./render/stages/captureStage.js";
import { RenderExecutionContext } from "./render/renderExecutionContext.js";

// Real orchestrator/context/artifact settlement; replace external stage IO only.
// Current upstream probes staged artifacts before commit. Stub only that media
// IO boundary: the synthetic file below is not a video or media-validation test.
vi.mock("../utils/ffprobe.js", () => ({
  extractMediaMetadata: vi.fn(async () => ({ durationSeconds: 1, frames: 30 })),
}));
vi.mock("node:fs/promises", async (original) => ({
  ...(await original<typeof import("node:fs/promises")>()),
  rm: vi.fn(),
}));
vi.mock("@hyperframes/engine", async (original) => ({
  ...(await original<typeof import("@hyperframes/engine")>()),
  assertConfiguredFfmpegBinariesExist: vi.fn(),
  resolveBrowserGpuMode: vi.fn(async () => "hardware"),
  resolveHeadlessShellPath: vi.fn(() => "/not-launched"),
  createCaptureSession: vi.fn(() => {
    throw new Error("unexpected browser launch");
  }),
}));
vi.mock("./fileServer.js", async (original) => ({
  ...(await original<typeof import("./fileServer.js")>()),
  createFileServer: vi.fn(async () => ({ url: "http://unused.invalid", close: vi.fn() })),
  closeFileServerSafely: vi.fn(),
}));
vi.mock("./render/stages/compileStage.js", () => ({ runCompileStage: vi.fn() }));
vi.mock("./render/stages/probeStage.js", () => ({
  runProbeStage: vi.fn(async (input) => ({
    compiled: input.compiled,
    fileServer: null,
    probeSession: null,
    lastBrowserConsole: [],
    duration: 1,
    totalFrames: 30,
    browserProbeMs: 0,
  })),
}));
vi.mock("./render/stages/extractVideosStage.js", async (original) => ({
  ...(await original<typeof import("./render/stages/extractVideosStage.js")>()),
  runExtractVideosStage: vi.fn(async () => ({
    extractionResult: null,
    frameLookup: null,
    videoReadinessSkipIds: [],
    videoMetadataHints: [],
    nativeHdrVideoIds: new Set(),
    videoTransfers: [],
    nativeHdrImageIds: new Set(),
    imageTransfers: [],
    hdrImageSrcPaths: new Map(),
    imageColorSpaces: [],
    videoExtractMs: 0,
    failureToEnforce: null,
  })),
}));
vi.mock("./render/stages/audioStage.js", () => ({
  runAudioStage: vi.fn(async () => ({ hasAudio: false, audioOutputPath: null, audioProcessMs: 0 })),
}));
vi.mock("./render/stages/captureStreamingStage.js", () => ({
  runCaptureStreamingStage: vi.fn(async () => ({ success: false })),
}));
vi.mock("./render/stages/captureStage.js", () => ({
  runCaptureStage: vi.fn(async () => ({
    workerCount: 1,
    probeSession: null,
    lastBrowserConsole: [],
  })),
}));
vi.mock("./render/stages/encodeStage.js", () => ({
  runEncodeStage: vi.fn(async () => ({ encodeMs: 0 })),
}));
vi.mock("./render/stages/assembleStage.js", () => ({
  runAssembleStage: vi.fn(async (input) => {
    writeFileSync(input.outputPath, "synthetic artifact, NOT video evidence");
    return { assembleMs: 0 };
  }),
}));
const roots: string[] = [];
beforeEach(async () => {
  vi.clearAllMocks();
  const fs = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
  vi.mocked(rm).mockImplementation(fs.rm);
  vi.mocked(runCompileStage).mockImplementation(
    // External compiler output is a deliberately partial fixture; the real
    // orchestrator and execution context remain under test.
    async () =>
      ({
        compiled: {
          html: "<div></div>",
          renderModeHints: { reasons: [] },
          hasShaderTransitions: false,
        },
        composition: { width: 640, height: 360, duration: 1, videos: [], audios: [], images: [] },
        deviceScaleFactor: 1,
        outputWidth: 640,
        outputHeight: 360,
        compileOnlyMs: 0,
        forceScreenshot: false,
      }) as unknown as Awaited<ReturnType<typeof runCompileStage>>,
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function setup(enabled = false, debug = false) {
  const root = mkdtempSync(join(tmpdir(), "native-workdir-owner-"));
  roots.push(root);
  vi.stubEnv("PRODUCER_RENDERS_DIR", join(root, "renders"));
  vi.stubEnv("KEEP_TEMP", "0");
  writeFileSync(join(root, "index.html"), "<div></div>");
  const log = { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() };
  const job = createRenderJob({
    fps: 30,
    quality: "standard",
    workers: 1,
    debug,
    logger: log,
    sourceStaticPlan: { enabled },
    producerConfig: {
      ...resolveConfig(),
      enableStreamingEncode: false,
      useDrawElement: false,
      lowMemoryMode: false,
    },
  });
  return { root, job, log, output: join(root, "output.mp4") };
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
describe("executeRenderJob workDir ownership", () => {
  it.each([undefined, "index.html", "alternate.html"])(
    "passes the selected render entry %s to the static-plan boundary",
    async (entryFile) => {
      const { root, job, output } = setup(true);
      job.config.entryFile = entryFile;
      if (entryFile === "alternate.html")
        writeFileSync(join(root, entryFile), '<div data-duration="1">alternate</div>');
      await executeRenderJob(job, root, output);
      expect(runCaptureStage).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceEntryFile: entryFile ?? "index.html",
          sourceStaticPlanEnabled: true,
        }),
      );
      expect(job.status).toBe("complete");
    },
  );
  it("does not grant direct-disk provenance to a streaming-unavailable fallback", async () => {
    const { root, job, output } = setup(true);
    if (!job.config.producerConfig) throw new Error("fixture config");
    job.config.producerConfig.enableStreamingEncode = true;
    await executeRenderJob(job, root, output);
    expect(runCaptureStreamingStage).toHaveBeenCalledTimes(1);
    expect(runCaptureStage).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceStaticPlanEnabled: true,
        initialDirectSdrDiskEligible: false,
        plan: expect.objectContaining({ kind: "sdr_disk" }),
      }),
    );
    expect(job.status).toBe("complete");
  });

  it.each([false, true])(
    "enabled=%s awaits async cleanup, leaves timer responsive and returns only after LIFO disposal",
    async (enabled) => {
      const { root, job, output } = setup(enabled);
      const entered = deferred(),
        release = deferred();
      const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
      const order: string[] = [];
      const originalDefer = RenderExecutionContext.prototype.defer;
      vi.spyOn(RenderExecutionContext.prototype, "defer").mockImplementation(
        function (this: RenderExecutionContext, name, dispose) {
          return originalDefer.call(this, name, async () => {
            order.push(name);
            await dispose();
          });
        },
      );
      vi.mocked(rm).mockImplementation(async (path, options) => {
        entered.resolve();
        await release.promise;
        await actual.rm(path, options);
      });
      let returned = false;
      const running = executeRenderJob(job, root, output).then(() => {
        returned = true;
      });
      await entered.promise;
      expect(job.status).toBe("complete");
      expect(returned).toBe(false);
      const [workDir, options] = vi.mocked(rm).mock.calls[0]!;
      expect(options).toEqual({ recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      expect(existsSync(workDir)).toBe(true);
      let healthTick = false;
      await new Promise<void>((r) =>
        setTimeout(() => {
          healthTick = true;
          r();
        }, 0),
      );
      expect(healthTick).toBe(true);
      expect(returned).toBe(false);
      expect(order).toEqual([
        "stop memory sampler",
        "close probe session",
        "close file server",
        "rollback staged artifact",
        "remove workDir",
      ]);
      expect(runCaptureStage).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceProjectDir: root,
          initialDirectSdrDiskEligible: true,
          sourceStaticPlanEnabled: enabled,
        }),
      );
      release.resolve();
      await running;
      expect(returned).toBe(true);
      expect(existsSync(workDir)).toBe(false);
      expect(rm).toHaveBeenCalledTimes(1);
      expect(existsSync(output)).toBe(true);
    },
  );
  it.each(["debug", "keep-temp"])(
    "%s preserves the directory on successful settlement",
    async (mode) => {
      const { root, job, output } = setup(false, mode === "debug");
      if (mode === "keep-temp") vi.stubEnv("KEEP_TEMP", "1");
      await executeRenderJob(job, root, output);
      expect(job.status).toBe("complete");
      expect(rm).not.toHaveBeenCalled();
      expect(existsSync(vi.mocked(runCompileStage).mock.calls[0]![0].workDir)).toBe(true);
    },
  );
  it("cleanup rejection remains best effort and logs without reversing successful settlement", async () => {
    const { root, job, log, output } = setup();
    vi.mocked(rm).mockRejectedValue(new Error("injected delete failure"));
    await expect(executeRenderJob(job, root, output)).resolves.toBeUndefined();
    expect(job.status).toBe("complete");
    expect(log.debug).toHaveBeenCalledWith(
      "Cleanup failed (remove workDir)",
      expect.objectContaining({ error: "injected delete failure" }),
    );
  });
  it("KEEP_TEMP does not retain a failed job; cleanup failure preserves the original error", async () => {
    const { root, job, output, log } = setup();
    vi.stubEnv("KEEP_TEMP", "1");
    vi.mocked(runCompileStage).mockRejectedValue(new Error("original compile failure"));
    vi.mocked(rm).mockRejectedValue(new Error("secondary cleanup failure"));
    await expect(executeRenderJob(job, root, output)).rejects.toThrow("original compile failure");
    expect(rm).toHaveBeenCalledTimes(1);
    expect(existsSync(output)).toBe(false);
    expect(log.debug).toHaveBeenCalledWith(
      "Cleanup failed (remove workDir)",
      expect.objectContaining({ error: "secondary cleanup failure" }),
    );
  });
});
