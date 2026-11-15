import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DrawElementCaptureError, resolveConfig, type ExtractedFrames } from "@hyperframes/engine";
import { selectCaptureCalibrationFrames } from "./render/captureCost.js";
import { CaptureStageError } from "./render/captureStageError.js";
import { createRenderJob, executeRenderJob } from "./renderOrchestrator.js";

// Entry: executeRenderJob with one long video whose frames are deferred when the extract stage is
// asked to. Every capture stage is scripted, so a test ends at the first stage that is reached.
const { state, REACHED } = vi.hoisted(() => ({
  state: {
    events: [] as string[],
    deferRequests: [] as Array<boolean | undefined>,
    segmentedWindow: [] as boolean[],
    segmentedOutcomes: [] as Array<"spawn_failed" | "drawelement_failure">,
    offerDeferredFrames: true,
    nativeHdr: false,
    extractions: [] as Array<{ frames: number[]; outputRoot: string }>,
    tables: [] as Array<FrameLookupTable | null>,
    calibrations: [] as Array<{
      folderExisted: boolean;
      frameIndex: number | undefined;
      frameOnDisk: boolean;
      extractionsBefore: number;
    }>,
    folderAtNextStage: [] as boolean[],
    logs: [] as string[],
    stages: [] as string[],
  },
  REACHED: "stage reached",
}));

vi.mock("@hyperframes/engine", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hyperframes/engine")>()),
  assertConfiguredFfmpegBinariesExist: () => {},
  resolveBrowserGpuMode: async () => "software",
  createVideoFrameInjector: (table: FrameLookupTable | null) => {
    state.tables.push(table);
    return Object.assign(async () => {}, { fresh: () => null });
  },
  createCaptureSession: async () => ({
    browserConsoleBuffer: [],
    options: {},
    isInitialized: false,
  }),
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
    composition: {
      width: 320,
      height: 180,
      duration: 40,
      videos: [
        {
          id: "long",
          src: "long.mp4",
          start: 0,
          end: 40,
          mediaStart: 0,
          loop: false,
          hasAudio: false,
        },
      ],
      images: [],
      audios: [],
    },
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
  runExtractVideosStage: async (input: { deferRangeExtraction?: boolean }) => {
    state.deferRequests.push(input.deferRangeExtraction);
    const deferred = input.deferRangeExtraction === true && state.offerDeferredFrames;
    const frame: ExtractedFrames = {
      videoId: "long",
      srcPath: "/project/long.mp4",
      outputDir: "/work/compiled/__hyperframes_video_frames/long",
      framePattern: "frame_%05d.jpg",
      fps: 30,
      totalFrames: 1200,
      metadata: {
        durationSeconds: 40,
        videoStreamDurationSeconds: 40,
        videoStreamStartSeconds: 0,
        width: 320,
        height: 180,
        fps: 30,
        videoCodec: "h264",
        hasAudio: false,
        isVFR: false,
        hasAlpha: false,
        colorSpace: null,
      },
      framePaths: new Map(
        deferred ? [] : Array.from({ length: 1200 }, (_, i) => [i, `/frames/${i}.jpg`] as const),
      ),
      ...(deferred
        ? { deferredRange: { startTime: 0, durationSeconds: 40, format: "jpg" as const } }
        : {}),
    };
    return {
      extractionResult: {
        success: true,
        errors: [],
        extracted: [frame],
        totalFramesExtracted: deferred ? 0 : 1200,
        durationMs: 1,
        phaseBreakdown: {},
      },
      frameLookup: null,
      videoReadinessSkipIds: [],
      videoMetadataHints: [],
      nativeHdrVideoIds: new Set<string>(state.nativeHdr ? ["long"] : []),
      videoTransfers: new Map(),
      nativeHdrImageIds: new Set<string>(),
      imageTransfers: new Map(),
      hdrImageSrcPaths: new Map(),
      imageColorSpaces: [],
      videoExtractMs: 0,
      failureToEnforce: null,
    };
  },
}));
vi.mock("./render/deferredVideoFrames.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./render/deferredVideoFrames.js")>();
  return {
    ...actual,
    extractAllDeferredFrames: async (
      extracted: ExtractedFrames[],
      input: { onProgress?: (done: number, total: number) => void },
    ) => {
      state.events.push("extract-all");
      for (const video of extracted) delete video.deferredRange;
      input.onProgress?.(1200, 1200);
    },
    // Stands in for ffmpeg: writes the frames the given output frames show, as the real one names them.
    extractDeferredFrames: async (input: Parameters<typeof actual.extractDeferredFrames>[0]) => {
      const frames = [...input.frames];
      state.extractions.push({ frames, outputRoot: input.outputRoot });
      const shown = actual.shownDeferredFrameIndexes(input, frames, input.fps);
      return input.extracted
        .filter((video) => video.deferredRange)
        .map((video) => {
          const outputDir = join(input.outputRoot, video.videoId);
          const framePaths = new Map<number, string>();
          for (const index of shown.get(video.videoId) ?? []) {
            mkdirSync(outputDir, { recursive: true });
            const path = join(outputDir, `frame_${String(index + 1).padStart(5, "0")}.jpg`);
            writeFileSync(path, "x");
            framePaths.set(index, path);
          }
          return { ...video, outputDir, framePaths, ownedByLookup: false };
        });
    },
  };
});
vi.mock("./render/stages/audioStage.js", () => ({
  runAudioStage: async () => ({ audioOutputPath: undefined, hasAudio: false, audioProcessMs: 0 }),
}));
vi.mock("./render/captureCost.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./render/captureCost.js")>()),
  resolveRenderWorkerCount: () => 1,
  runCaptureCalibration: async (input: {
    forceScreenshot: boolean;
    probeSession: unknown;
    createRenderVideoFrameInjector: () => ((...args: never[]) => Promise<void>) | null;
  }) => {
    const root = state.extractions.find((e) => e.outputRoot.endsWith("calibration"))?.outputRoot;
    const hook = input.createRenderVideoFrameInjector();
    const table = state.tables.at(-1);
    const shown = hook && root ? table?.getActiveFramePayloads(600 / 30).get("long") : undefined;
    state.calibrations.push({
      folderExisted: root !== undefined && existsSync(root),
      frameIndex: shown?.frameIndex,
      frameOnDisk: shown !== undefined && existsSync(shown.framePath),
      extractionsBefore: state.extractions.length,
    });
    return {
      calibration: undefined,
      forceScreenshot: input.forceScreenshot,
      probeSession: input.probeSession,
      lastBrowserConsole: [],
    };
  },
}));
vi.mock("./render/stages/captureSegmentedStage.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./render/stages/captureSegmentedStage.js")>()),
  runCaptureSegmentedStage: async (input: { segmentVideoFrames?: unknown }) => {
    state.events.push("segmented");
    const calibrationRoot = state.extractions.find((e) => e.outputRoot.endsWith("calibration"));
    if (calibrationRoot) state.folderAtNextStage.push(existsSync(calibrationRoot.outputRoot));
    state.segmentedWindow.push(input.segmentVideoFrames !== undefined);
    const outcome = state.segmentedOutcomes.shift();
    if (outcome === "spawn_failed") return { success: false };
    if (outcome === "drawelement_failure") {
      throw new CaptureStageError({
        cause: new DrawElementCaptureError(640, "suspect small frame"),
        browserConsole: [],
      });
    }
    throw new Error(REACHED);
  },
}));
vi.mock("./render/stages/captureStreamingStage.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./render/stages/captureStreamingStage.js")>()),
  runCaptureStreamingStage: async () => {
    state.events.push("streaming");
    throw new Error(REACHED);
  },
}));
vi.mock("./render/stages/captureHdrStage.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./render/stages/captureHdrStage.js")>()),
  runCaptureHdrStage: async () => {
    state.events.push("hdr");
    throw new Error(REACHED);
  },
}));

const dirs: string[] = [];
beforeEach(() => {
  state.events = [];
  state.deferRequests = [];
  state.segmentedWindow = [];
  state.segmentedOutcomes = [];
  state.offerDeferredFrames = true;
  state.nativeHdr = false;
  state.extractions = [];
  state.calibrations = [];
  state.tables = [];
  state.folderAtNextStage = [];
  state.logs = [];
  state.stages = [];
  stubRenderFlags();
});
function stubRenderFlags(): void {
  vi.stubEnv("HF_SEGMENTED_CAPTURE", "true");
  vi.stubEnv("HF_VIDEO_FRAME_WINDOW", "true");
  vi.stubEnv("PRODUCER_EXPERIMENTAL_FAST_CAPTURE", "");
  vi.stubEnv("HF_DE_PARALLEL_STREAM", "");
  vi.stubEnv("HF_DE_PARALLEL_ROUTER", "false");
  vi.stubEnv("HF_DE_PARALLEL_MIN_MEM_MB", "0");
  vi.stubEnv("HF_DE_SINGLE_MIN_FRAMES", "900");
}
afterEach(() => {
  vi.unstubAllEnvs();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function render(config: Partial<Parameters<typeof createRenderJob>[0]> = {}): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "hf-video-frame-window-"));
  dirs.push(root);
  writeFileSync(join(root, "index.html"), "<div></div>");
  const job = createRenderJob({
    fps: 30,
    quality: "standard",
    hdrMode: "auto",
    producerConfig: resolveConfig({ useDrawElement: true, browserGpuMode: "software" }),
    logger: {
      info: (message: string) => void state.logs.push(message),
      warn() {},
      error() {},
      debug() {},
    },
    ...config,
  });
  return executeRenderJob(job, root, join(root, `output.${config.format ?? "mp4"}`), (j) => {
    if (j.currentStage && state.stages.at(-1) !== j.currentStage) state.stages.push(j.currentStage);
  });
}

// A worker's first render pays a one-time start-up cost: tens of ms on an idle host, up to 6 s on a loaded CI
// runner. One render here pays it outside the tests, so each test's 5 s covers only its own rule.
beforeAll(async () => {
  stubRenderFlags();
  await render().catch(() => undefined);
  vi.unstubAllEnvs();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

it("a segmented render with the flag on defers the long video and windows its frames", async () => {
  await expect(render()).rejects.toThrow(REACHED);
  expect(state.deferRequests).toEqual([true]);
  expect(state.segmentedWindow).toEqual([true]);
  expect(state.events).toEqual(["segmented"]);
});

it.each(["false", "0", "off", "no", ""])(
  "with the flag %j, deferRangeExtraction stays unset and the render is as it was",
  async (value) => {
    vi.stubEnv("HF_VIDEO_FRAME_WINDOW", value);
    await expect(render()).rejects.toThrow(REACHED);
    expect(state.deferRequests).toEqual([undefined]);
    expect(state.segmentedWindow).toEqual([false]);
    expect(state.events).toEqual(["segmented"]);
  },
);

it("with the flag unset, deferRangeExtraction stays unset", async () => {
  vi.stubEnv("HF_VIDEO_FRAME_WINDOW", undefined);
  await expect(render()).rejects.toThrow(REACHED);
  expect(state.deferRequests).toEqual([undefined]);
  expect(state.segmentedWindow).toEqual([false]);
});

it("a render that would not segment never defers", async () => {
  vi.stubEnv("HF_SEGMENTED_CAPTURE", "false");
  await expect(render()).rejects.toThrow(REACHED);
  expect(state.deferRequests).toEqual([undefined]);
  expect(state.events).toEqual(["streaming"]);
});

it.each([
  ["a webm render", { format: "webm" as const }, "streaming"],
  ["a motion-blur render", { motionBlur: { samplesPerFrame: 4 } }, "segmented"],
])("%s never defers", async (_label, config, stage) => {
  await expect(render(config)).rejects.toThrow(REACHED);
  expect(state.deferRequests).toEqual([undefined]);
  expect(state.segmentedWindow).not.toContain(true);
  expect(state.events).toEqual([stage]);
});

it("flag on with no long video to defer is the same render as flag off", async () => {
  state.offerDeferredFrames = false;
  await expect(render()).rejects.toThrow(REACHED);
  expect(state.segmentedWindow).toEqual([false]);
  expect(state.events).toEqual(["segmented"]);
});

it("a render that leaves the segmented route has every frame before capture starts", async () => {
  state.segmentedOutcomes = ["spawn_failed"];
  await expect(render()).rejects.toThrow(REACHED);
  expect(state.events).toEqual(["segmented", "extract-all", "streaming"]);
});

it("a render whose final plan is not segmented extracts everything before its first capture", async () => {
  state.nativeHdr = true;
  await expect(render({ hdrMode: "force-hdr" })).rejects.toThrow(REACHED);
  expect(state.events).toEqual(["extract-all", "hdr"]);
});

it("a drawElement retry stays on the segmented route and keeps windowing", async () => {
  state.segmentedOutcomes = ["drawelement_failure"];
  await expect(render()).rejects.toThrow(REACHED);
  expect(state.events).toEqual(["segmented", "segmented"]);
  expect(state.segmentedWindow).toEqual([true, true]);
});

it("calibration on the windowed route injects real frames for its samples and removes them afterwards", async () => {
  await expect(render()).rejects.toThrow(REACHED);
  const calibration = state.extractions.find((e) => e.outputRoot.endsWith("calibration"));
  expect(calibration?.frames).toEqual(selectCaptureCalibrationFrames(1200));
  expect(state.calibrations).toEqual([
    { folderExisted: true, frameIndex: 600, frameOnDisk: true, extractionsBefore: 1 },
  ]);
  expect(state.folderAtNextStage).toEqual([false]);
});

it("extracts the calibration frames before the first timed sample", async () => {
  await expect(render()).rejects.toThrow(REACHED);
  // The scripted calibration is the first thing that would be timed; by then the extraction is done.
  expect(state.calibrations.map((c) => c.extractionsBefore)).toEqual([1]);
});

it("with the flag off, calibration extracts nothing", async () => {
  vi.stubEnv("HF_VIDEO_FRAME_WINDOW", "false");
  await expect(render()).rejects.toThrow(REACHED);
  expect(state.extractions).toEqual([]);
  expect(state.calibrations).toHaveLength(1);
});

it("the late full extraction is logged and moves the job's progress", async () => {
  state.segmentedOutcomes = ["spawn_failed"];
  await expect(render()).rejects.toThrow(REACHED);
  expect(state.logs).toEqual(
    expect.arrayContaining([
      "[Render] Extracting the frames of the videos a window would have held back",
      "[Render] Extracted the deferred video frames",
    ]),
  );
  expect(state.stages).toContain("Extracting video frames");
});

const WINDOW_LOGS = [
  "[Render] HF_VIDEO_FRAME_WINDOW is set but this render extracts every frame",
  "[Render] Video frame window",
];

it("a windowed render says how many videos it windowed and how many stayed fully extracted", async () => {
  await expect(render()).rejects.toThrow(REACHED);
  expect(state.logs).toContain("[Render] Video frame window");
  expect(state.logs).not.toContain(WINDOW_LOGS[0]);
});

it.each([
  ["a webm render", { format: "webm" as const }],
  ["a motion-blur render", { motionBlur: { samplesPerFrame: 4 } }],
])("%s with the flag on says it extracts every frame", async (_label, config) => {
  await expect(render(config)).rejects.toThrow(REACHED);
  expect(state.logs).toContain(WINDOW_LOGS[0]);
  expect(state.logs).not.toContain(WINDOW_LOGS[1]);
});

it("a render that would not segment says so when the flag is on", async () => {
  vi.stubEnv("HF_SEGMENTED_CAPTURE", "false");
  await expect(render()).rejects.toThrow(REACHED);
  expect(state.logs).toContain(WINDOW_LOGS[0]);
});

it("with the flag off, nothing about windowing is logged", async () => {
  vi.stubEnv("HF_VIDEO_FRAME_WINDOW", "false");
  await expect(render()).rejects.toThrow(REACHED);
  expect(state.logs.filter((message) => WINDOW_LOGS.includes(message))).toEqual([]);
});
