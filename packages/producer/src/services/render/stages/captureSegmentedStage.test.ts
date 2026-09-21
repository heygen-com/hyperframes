// fallow-ignore-file code-duplication
import { afterAll, describe, expect, it, mock } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const fixtureRoot = mkdtempSync(join(tmpdir(), "hf-segmented-test-"));
const framesDir = join(fixtureRoot, "frames");
afterAll(() => rmSync(fixtureRoot, { recursive: true, force: true }));
import { createCapturePlan } from "../capturePlan.js";
import { runCaptureSegmentedStage, segmentOutputPath } from "./captureSegmentedStage.js";

const writeFrame = mock((_buffer: Buffer) => true);
const closeEncoder = mock(async () => ({ success: true, durationMs: 123, fileSize: 42 }));
const spawnStreamingEncoder = mock(async () => ({
  writeFrame,
  close: closeEncoder,
  getExitStatus: () => "success",
  getExitError: () => undefined,
}));
let failCaptureFrameToBuffer = false;
let failInitializeSession = false;
let hangParallelUntilAbort = false;
let hangSequentialUntilStall = false;
let sessionWorkerEncodeEnabled = false;
let captureSessionMode: "drawelement" | "screenshot" = "drawelement";
let failPrepareCaptureSessionForReuse = false;
let initializeSessionErrorMessage = "initialize failed";
const browserConsoleBuffer = ["[FrameCapture:ERROR] page.goto failed"];
const closeCaptureSession = mock(async () => {});
class DrawElementVerificationError extends Error {}

mock.module("@hyperframes/engine", () => ({
  calculateOptimalWorkers: () => 1,
  convertTransfer: () => {},
  captureFrame: async () => {},
  captureFrameToBufferPipelined: async () => {
    if (hangSequentialUntilStall) {
      return new Promise(() => {});
    }
    return { encodeResult: Promise.resolve(Buffer.from("frame")) };
  },
  captureFramesBatchPipelined: async () => {
    if (hangSequentialUntilStall) {
      return new Promise(() => {});
    }
    return [];
  },
  captureFrameToBuffer: async () => {
    if (failCaptureFrameToBuffer) {
      throw new Error("captureFrameToBuffer failed");
    }
    if (hangSequentialUntilStall) {
      return new Promise(() => {});
    }
    return { buffer: Buffer.from("frame"), captureTimeMs: 1 };
  },
  closeCaptureSession,
  completeDeferredDrawElementInit: async () => {},
  createCaptureSession: async () => ({
    isInitialized: false,
    browserConsoleBuffer,
    options: { captureBeyondViewport: false },
    workerEncodeEnabled: sessionWorkerEncodeEnabled,
    captureMode: captureSessionMode,
  }),
  createFrameReorderBuffer: () => ({
    waitForFrame: async () => {},
    advanceTo: () => {},
    abort: () => {},
  }),
  distributeFrames: () => [],
  distributeFramesInterleaved: () => [],
  DrawElementVerificationError,
  executeParallelCapture: async (
    _url: string,
    _workDir: string,
    _tasks: unknown,
    _opts: unknown,
    _hook: unknown,
    signal?: AbortSignal,
    onProgress?: (progress: unknown) => void,
  ) => {
    if (hangParallelUntilAbort) {
      onProgress?.({
        totalFrames: 100,
        capturedFrames: 0,
        activeWorkers: 2,
        workerProgress: new Map([
          [0, 0],
          [1, 0],
        ]),
        latestWorkerPhase: {
          workerId: 0,
          phase: "session_init",
          browserExecutable: "C:/Chrome/chrome.exe",
          browserVersion: "Chrome/152.0.7977.30",
          canvasDrawElement: true,
          gpuBackend: "d3d11/nvidia",
        },
      });
      // Simulate a wedged worker: make no frame progress, then reject with the
      // pool's generic string once aborted (by the parent or the watchdog).
      await new Promise<void>((_resolve, reject) => {
        const fail = () => reject(new Error("[Parallel] Capture failed: aborted"));
        if (signal?.aborted) return fail();
        signal?.addEventListener("abort", fail, { once: true });
      });
    }
    return [];
  },
  getCapturePerfSummary: () => ({}),
  getFfmpegBinary: () => "ffmpeg",
  initializeSession: async (session: { isInitialized: boolean }) => {
    if (failInitializeSession) {
      throw new Error(initializeSessionErrorMessage);
    }
    session.isInitialized = true;
  },
  getEncoderPreset: () => ({
    preset: "ultrafast",
    quality: 28,
    codec: "h264",
    pixelFormat: "yuv420p",
  }),
  initTransparentBackground: async () => {},
  prepareCaptureSessionForReuse: () => {
    if (failPrepareCaptureSessionForReuse) {
      throw new Error("prepare reuse failed: ENOSPC");
    }
  },
  recaptureDrawElementFrameForVerify: async () => Buffer.from("frame"),
  spawnStreamingEncoder,
  writeCapturedFrame: async () => {},
}));

mock.module("@hyperframes/core", () => ({
  CANVAS_DIMENSIONS: {},
  checkOutputResolutionCompatibility: () => ({ ok: true }),
  fpsToNumber: () => 30,
  redactTelemetryString: (value: string) => value,
}));

mock.module("../../renderOrchestrator.js", () => ({
  closeHdrVideoFrameSource: () => {},
  createHdrPerfCollector: () => ({}),
  executeDiskCaptureWithAdaptiveRetry: async () => [],
  resolveCompositeTransfer: () => "srgb",
}));

mock.module("../../hdrCompositor.js", () => ({
  closeHdrVideoFrameSource: () => {},
  resolveCompositeTransfer: () => "srgb",
}));

mock.module("./captureHdrResources.js", () => ({
  cleanupHdrVideoFrameSource: () => {},
  decodeHdrImageBuffers: () => new Map(),
  extractHdrVideoFrames: async () => ({
    sources: new Map(),
    estimatedBytes: 0,
    releaseReservation: () => {},
  }),
  planHdrResources: () => ({
    hdrVideoStartTimes: new Map(),
    nativeHdrVideos: [],
    nativeHdrImages: [],
  }),
  probeHdrExtractionDims: async () => {},
}));

mock.module("./captureHdrFrameShared.js", () => ({
  ensureFrameWritten: () => {},
  partitionTransitionFrames: () => new Set(),
  shouldUseHybridLayeredPath: () => false,
}));

mock.module("./captureHdrSequentialLoop.js", () => ({
  runSequentialLayeredFrameLoop: async () => {},
}));

mock.module("./captureHdrHybridLoop.js", () => ({
  runHybridLayeredFrameLoop: async () => {},
}));

function segmentedPlan() {
  const plan = createCapturePlan({
    workerCount: 1,
    forceScreenshot: false,
    useStreamingEncode: true,
    useLayeredComposite: false,
    usePageSideCompositing: false,
    hasHdrContent: false,
    needsAlpha: false,
    useSegmentedCapture: true,
  });
  if (plan.kind !== "sdr_segmented") throw new Error(`expected sdr_segmented, got ${plan.kind}`);
  return plan;
}

function fakeStageInput(overrides: { totalFrames: number }) {
  return {
    fileServer: {
      url: "http://127.0.0.1:4173",
      port: 4173,
      close: () => {},
      addPreHeadScript: () => {},
    },
    workDir: fixtureRoot,
    framesDir,
    videoOnlyPath: join(fixtureRoot, "video-only.mp4"),
    job: {
      id: "segmented-test",
      config: { fps: { num: 30, den: 1 }, quality: "draft" as const },
      status: "queued" as const,
      progress: 0,
      currentStage: "Segmented",
      createdAt: new Date(0),
      duration: 1,
    },
    cfg: { forceScreenshot: false, ffmpegStreamingTimeout: 1000 },
    plan: segmentedPlan(),
    log: { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} },
    // Already-initialized fake session: the stage must not reach the real
    // createCaptureSession, and the per-frame loop only reads captureMode.
    probeSession: {
      isInitialized: true,
      browserConsoleBuffer,
      options: { captureBeyondViewport: false },
      workerEncodeEnabled: false,
      captureMode: "screenshot" as const,
    },
    outputFormat: "mp4",
    streamingEncoderOptions: { fps: { num: 30, den: 1 }, width: 16, height: 16 },
    buildCaptureOptions: () => ({ width: 16, height: 16 }),
    createRenderVideoFrameInjector: () => null,
    abortSignal: undefined,
    assertNotAborted: () => {},
    dedupPerfs: [],
    ...overrides,
  };
}

describe("segmentOutputPath", () => {
  it("zero-pads so lexical order equals frame order", () => {
    expect(segmentOutputPath("/w/segments", 7)).toBe("/w/segments/segment_00007.mp4");
  });
});

describe("runCaptureSegmentedStage", () => {
  it("spawns one encoder per segment, writes every frame once in order, then concats", async () => {
    const written: Array<{ segment: string; frame: number }> = [];
    const encoders: string[] = [];
    const spawnEncoder = mock(async (outputPath: string) => {
      encoders.push(outputPath);
      return {
        writeFrame: async (buf: Buffer) => {
          written.push({ segment: outputPath, frame: buf.readUInt32BE(0) });
          return true;
        },
        close: async () => ({ success: true, durationMs: 5, fileSize: 1 }),
        getExitStatus: () => "success" as const,
        getExitError: () => undefined,
      };
    });
    const captureFrame = mock(async (_session: unknown, frameIndex: number) => {
      const buffer = Buffer.alloc(4);
      buffer.writeUInt32BE(frameIndex, 0);
      return { buffer };
    });
    const concat = mock(async () => ({ success: true as const }));
    const observed: unknown[] = [];

    const result = await runCaptureSegmentedStage({
      ...fakeStageInput({ totalFrames: 7 }),
      segmentFrames: 3,
      deps: { spawnEncoder, captureFrame, concat },
      updateCaptureObservability: (p) => observed.push(p),
    });

    expect(result.success).toBe(true);
    expect(encoders).toEqual([
      segmentOutputPath(join(fixtureRoot, "segments"), 0),
      segmentOutputPath(join(fixtureRoot, "segments"), 1),
      segmentOutputPath(join(fixtureRoot, "segments"), 2),
    ]);
    // Every frame exactly once, in order, across the segment boundaries.
    expect(written.map((w) => w.frame)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(
      written.filter((w) => w.segment.endsWith("segment_00001.mp4")).map((w) => w.frame),
    ).toEqual([3, 4, 5]);
    expect(concat).toHaveBeenCalledWith(
      encoders,
      join(fixtureRoot, "video-only.mp4"),
      undefined,
      expect.anything(),
    );
    expect(observed[0]).toEqual({ capturePath: "segmented", segmentIndex: 0 });
    // The GOP is the segment's own length, so every boundary is an IDR — the
    // tail segment is shorter and must say so.
    expect(spawnEncoder.mock.calls[1]?.[1]).toMatchObject({
      lockGopForChunkConcat: true,
      gopSize: 3,
    });
    expect(spawnEncoder.mock.calls[2]?.[1]).toMatchObject({
      lockGopForChunkConcat: true,
      gopSize: 1,
    });
  });

  it("skips completed segments and still concats all of them in order", async () => {
    const stableDir = join(fixtureRoot, "stable");
    const spawned: string[] = [];
    const spawnEncoder = mock(async (outputPath: string) => {
      spawned.push(outputPath);
      return {
        writeFrame: async () => true,
        close: async () => ({ success: true, durationMs: 1, fileSize: 1 }),
        getExitStatus: () => "success" as const,
        getExitError: () => undefined,
      };
    });
    const captured: number[] = [];
    const captureFrame = mock(async (_s: unknown, i: number) => {
      captured.push(i);
      return { buffer: Buffer.alloc(1) };
    });
    const concat = mock(async () => ({ success: true as const }));
    const completed: number[] = [];

    const result = await runCaptureSegmentedStage({
      ...fakeStageInput({ totalFrames: 9 }),
      segmentFrames: 3,
      segmentDir: stableDir,
      completedSegments: new Set([0]),
      onSegmentComplete: (e) => completed.push(e.index),
      deps: { spawnEncoder, captureFrame, concat },
    });

    expect(result.success).toBe(true);
    // Segment 0's frames are not re-captured, and no encoder is spawned for it.
    expect(captured).toEqual([3, 4, 5, 6, 7, 8]);
    expect(spawned).toEqual([segmentOutputPath(stableDir, 1), segmentOutputPath(stableDir, 2)]);
    expect(completed).toEqual([1, 2]);
    // The skipped segment is still concatenated, in order.
    expect(concat).toHaveBeenCalledWith(
      [
        segmentOutputPath(stableDir, 0),
        segmentOutputPath(stableDir, 1),
        segmentOutputPath(stableDir, 2),
      ],
      join(fixtureRoot, "video-only.mp4"),
      undefined,
      expect.anything(),
    );
  });

  it("concats without opening a browser when every segment is already complete", async () => {
    const create = mock(async () => fakeSession(99));
    const closeSession = mock(async () => {});
    const concat = mock(async () => ({ success: true as const }));
    const input = fakeStageInput({ totalFrames: 3 });
    const stableDir = join(fixtureRoot, "stable-all");
    const result = await runCaptureSegmentedStage({
      ...input,
      segmentFrames: 1,
      segmentDir: stableDir,
      completedSegments: new Set([0, 1, 2]),
      sessionFactory: { create },
      deps: { concat, closeSession },
    });
    expect(result.success).toBe(true);
    expect(create).not.toHaveBeenCalled();
    // The probe handed in by the orchestrator is still closed on this path.
    expect(closeSession).toHaveBeenCalledWith(input.probeSession);
    expect(concat).toHaveBeenCalledWith(
      [0, 1, 2].map((i) => segmentOutputPath(stableDir, i)),
      join(fixtureRoot, "video-only.mp4"),
      undefined,
      expect.anything(),
    );
  });

  it("can fall back when the first PENDING segment fails to spawn on a resume", async () => {
    // Segment 0 is already done, so segment 1 is the first one this run has to
    // capture; nothing new is on disk yet, so the plain streaming path is
    // still a safe replan target.
    const spawnEncoder = mock(async () => {
      throw new Error("ffmpeg missing");
    });
    const result = await runCaptureSegmentedStage({
      ...fakeStageInput({ totalFrames: 6 }),
      segmentFrames: 3,
      segmentDir: join(fixtureRoot, "stable2"),
      completedSegments: new Set([0]),
      deps: { spawnEncoder },
    });
    expect(result).toEqual({ success: false });
  });

  it("returns success:false when the first encoder cannot spawn, and has closed the probe", async () => {
    const spawnEncoder = mock(async () => {
      throw new Error("ffmpeg missing");
    });
    closeCaptureSession.mockClear();
    const input = fakeStageInput({ totalFrames: 3 });
    const result = await runCaptureSegmentedStage({
      ...input,
      segmentFrames: 3,
      deps: { spawnEncoder },
    });
    expect(result).toEqual({ success: false });
    // The orchestrator falls through to the streaming plan on this result and
    // must not hand it the same session: the stage's finally has closed it.
    expect(closeCaptureSession.mock.calls.map((c) => c[0])).toContain(input.probeSession);
  });

  it("throws when a later encoder fails to close cleanly", async () => {
    // A later segment cannot fall back: earlier segments are already encoded,
    // so the failure has to surface rather than silently drop frames.
    let closes = 0;
    const spawnEncoder = mock(async () => ({
      writeFrame: async () => true,
      close: async () =>
        closes++ === 1
          ? { success: false, durationMs: 1, fileSize: 0, error: "boom" }
          : { success: true, durationMs: 1, fileSize: 1 },
      getExitStatus: () => "success" as const,
      getExitError: () => undefined,
    }));
    const captureFrame = mock(async () => ({ buffer: Buffer.alloc(4) }));
    await expect(
      runCaptureSegmentedStage({
        ...fakeStageInput({ totalFrames: 4 }),
        segmentFrames: 2,
        deps: { spawnEncoder, captureFrame },
      }),
    ).rejects.toThrow(/[Ss]egment 1/);
  });

  it("does not concat when a later encoder fails to spawn", async () => {
    let spawns = 0;
    const spawnEncoder = mock(async () => {
      if (spawns++ === 1) throw new Error("ffmpeg vanished");
      return {
        writeFrame: async () => true,
        close: async () => ({ success: true, durationMs: 1, fileSize: 1 }),
        getExitStatus: () => "success" as const,
        getExitError: () => undefined,
      };
    });
    const captureFrame = mock(async () => ({ buffer: Buffer.alloc(4) }));
    const concat = mock(async () => ({ success: true as const }));
    await expect(
      runCaptureSegmentedStage({
        ...fakeStageInput({ totalFrames: 4 }),
        segmentFrames: 2,
        deps: { spawnEncoder, captureFrame, concat },
      }),
    ).rejects.toThrow(/ffmpeg vanished/);
    expect(concat).not.toHaveBeenCalled();
  });

  function okEncoder() {
    return {
      writeFrame: async () => true,
      close: async () => ({ success: true, durationMs: 1, fileSize: 1 }),
      getExitStatus: () => "success" as const,
      getExitError: () => undefined,
    };
  }

  function fakeSession(id: number) {
    return {
      id,
      isInitialized: true,
      browserConsoleBuffer,
      options: { captureBeyondViewport: false },
      workerEncodeEnabled: false,
      captureMode: "screenshot" as const,
    };
  }

  it("recycles the browser on the configured cadence", async () => {
    const created: number[] = [];
    const closed: number[] = [];
    let next = 0;
    const sessionFactory = {
      create: async () => {
        const s = fakeSession(next++);
        created.push(s.id);
        return s;
      },
    };
    const result = await runCaptureSegmentedStage({
      ...fakeStageInput({ totalFrames: 6 }),
      segmentFrames: 2,
      segmentDir: join(fixtureRoot, "recycle"),
      sessionFactory,
      browserRecycleEverySegments: 1,
      deps: {
        spawnEncoder: mock(async () => okEncoder()),
        captureFrame: mock(async () => ({ buffer: Buffer.alloc(1) })),
        concat: mock(async () => ({ success: true as const })),
        closeSession: mock(async (s: { id: number }) => {
          closed.push(s.id);
        }),
        removeFile: () => {},
      },
    });
    expect(result.success).toBe(true);
    if (!result.success) throw new Error("unreachable");
    // One session per segment: the first, then a recycle before segments 2 and 3.
    expect(created).toEqual([0, 1, 2]);
    expect(closed).toEqual([0, 1, 2]);
    expect(result.browserRecycles).toBe(2);
    expect(result.segmentRetries).toBe(0);
  });

  it("keeps one session when the cadence is 0", async () => {
    const created: number[] = [];
    let next = 0;
    await runCaptureSegmentedStage({
      ...fakeStageInput({ totalFrames: 6 }),
      segmentFrames: 2,
      segmentDir: join(fixtureRoot, "norecycle"),
      sessionFactory: {
        create: async () => {
          const s = fakeSession(next++);
          created.push(s.id);
          return s;
        },
      },
      browserRecycleEverySegments: 0,
      deps: {
        spawnEncoder: mock(async () => okEncoder()),
        captureFrame: mock(async () => ({ buffer: Buffer.alloc(1) })),
        concat: mock(async () => ({ success: true as const })),
        closeSession: mock(async () => {}),
        removeFile: () => {},
      },
    });
    expect(created).toEqual([0]);
  });

  it("retries a segment once on a fresh session after a target loss", async () => {
    let next = 0;
    const captured: number[] = [];
    let failed = false;
    const removed: string[] = [];
    const result = await runCaptureSegmentedStage({
      ...fakeStageInput({ totalFrames: 4 }),
      segmentFrames: 2,
      segmentDir: join(fixtureRoot, "retry"),
      sessionFactory: { create: async () => fakeSession(next++) },
      deps: {
        spawnEncoder: mock(async () => okEncoder()),
        captureFrame: mock(async (_s: unknown, i: number) => {
          if (i === 2 && !failed) {
            failed = true;
            throw new Error("Protocol error (Page.captureScreenshot): Target closed");
          }
          captured.push(i);
          return { buffer: Buffer.alloc(1) };
        }),
        concat: mock(async () => ({ success: true as const })),
        closeSession: mock(async () => {}),
        removeFile: (p: string) => removed.push(p),
      },
    });
    expect(result.success).toBe(true);
    if (!result.success) throw new Error("unreachable");
    expect(result.segmentRetries).toBe(1);
    // Segment 1 restarts from its first frame on the fresh session.
    expect(captured).toEqual([0, 1, 2, 3]);
    // The partial segment file is deleted so a later resume cannot see it.
    expect(removed).toEqual([segmentOutputPath(join(fixtureRoot, "retry"), 1)]);
    expect(next).toBe(2);
  });

  it("does not retry a non-target-loss failure", async () => {
    let next = 0;
    await expect(
      runCaptureSegmentedStage({
        ...fakeStageInput({ totalFrames: 4 }),
        segmentFrames: 2,
        segmentDir: join(fixtureRoot, "noretry"),
        sessionFactory: { create: async () => fakeSession(next++) },
        deps: {
          spawnEncoder: mock(async () => okEncoder()),
          captureFrame: mock(async (_s: unknown, i: number) => {
            if (i === 2) throw new Error("media_start_out_of_range");
            return { buffer: Buffer.alloc(1) };
          }),
          concat: mock(async () => ({ success: true as const })),
          closeSession: mock(async () => {}),
          removeFile: () => {},
        },
      }),
    ).rejects.toThrow(/media_start_out_of_range/);
    // No recycle: the session count never grew past the initial one.
    expect(next).toBe(1);
  });

  it("fails when the retry fails too", async () => {
    let next = 0;
    await expect(
      runCaptureSegmentedStage({
        ...fakeStageInput({ totalFrames: 4 }),
        segmentFrames: 2,
        segmentDir: join(fixtureRoot, "retryfail"),
        sessionFactory: { create: async () => fakeSession(next++) },
        deps: {
          spawnEncoder: mock(async () => okEncoder()),
          captureFrame: mock(async (_s: unknown, i: number) => {
            if (i === 2) throw new Error("Protocol error: Session closed.");
            return { buffer: Buffer.alloc(1) };
          }),
          concat: mock(async () => ({ success: true as const })),
          closeSession: mock(async () => {}),
          removeFile: () => {},
        },
      }),
    ).rejects.toThrow(/Session closed/);
    // Exactly one retry: initial session + one recycle, not a loop.
    expect(next).toBe(2);
  });

  it("distributes 7 segments over 3 workers, each frame once, concat in index order", async () => {
    const perWorkerSessions = new Map<number, number>();
    const sessionFactoryForWorker = (workerId: number) => ({
      create: async () => {
        perWorkerSessions.set(workerId, (perWorkerSessions.get(workerId) ?? 0) + 1);
        return fakeSession(workerId);
      },
    });
    const captured: number[] = [];
    const captureFrame = mock(async (_s: unknown, i: number) => {
      captured.push(i);
      // Yield so the workers actually interleave rather than running serially.
      await new Promise((r) => setTimeout(r, 1));
      return { buffer: Buffer.alloc(1) };
    });
    const concat = mock(async () => ({ success: true as const }));
    const stableDir = join(fixtureRoot, "workers");

    const result = await runCaptureSegmentedStage({
      ...fakeStageInput({ totalFrames: 20 }),
      probeSession: null,
      segmentFrames: 3,
      segmentDir: stableDir,
      workerCount: 3,
      sessionFactoryForWorker,
      deps: {
        spawnEncoder: mock(async () => okEncoder()),
        captureFrame,
        concat,
        closeSession: mock(async () => {}),
        removeFile: () => {},
      },
    });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error("unreachable");
    expect(result.workerCount).toBe(3);
    expect(result.segments).toBe(7);
    // Every frame exactly once across all workers, none duplicated.
    expect([...captured].sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => i));
    expect(new Set(captured).size).toBe(20);
    expect(perWorkerSessions.size).toBe(3);
    const concatInputs = concat.mock.calls[0]?.[0];
    expect(concatInputs).toEqual(
      Array.from({ length: 7 }, (_, i) => segmentOutputPath(stableDir, i)),
    );
  });

  it("closes every worker session when one worker fails hard", async () => {
    const closed: number[] = [];
    let id = 0;
    const result = runCaptureSegmentedStage({
      ...fakeStageInput({ totalFrames: 9 }),
      probeSession: null,
      segmentFrames: 3,
      segmentDir: join(fixtureRoot, "workerfail"),
      workerCount: 3,
      sessionFactoryForWorker: () => ({ create: async () => fakeSession(id++) }),
      deps: {
        spawnEncoder: mock(async () => okEncoder()),
        captureFrame: mock(async (_s: unknown, i: number) => {
          if (i === 4) throw new Error("media_start_out_of_range");
          return { buffer: Buffer.alloc(1) };
        }),
        concat: mock(async () => ({ success: true as const })),
        closeSession: mock(async (s: { id: number }) => {
          closed.push(s.id);
        }),
        removeFile: () => {},
      },
    });
    await expect(result).rejects.toThrow(/media_start_out_of_range/);
    // A leaked Chrome per worker is the failure mode this guards.
    expect(closed.length).toBe(3);
  });

  it("does not fall back to streaming when several workers are in flight", async () => {
    // Only the first segment's encoder fails; the others spawn fine. With one
    // worker that is the documented fallback, but here other workers are
    // already encoding, so discarding the render would throw away their work.
    let id = 0;
    let spawns = 0;
    await expect(
      runCaptureSegmentedStage({
        ...fakeStageInput({ totalFrames: 9 }),
        probeSession: null,
        segmentFrames: 3,
        segmentDir: join(fixtureRoot, "nofallback"),
        workerCount: 3,
        sessionFactoryForWorker: () => ({ create: async () => fakeSession(id++) }),
        deps: {
          spawnEncoder: mock(async () => {
            if (spawns++ === 0) throw new Error("ffmpeg missing");
            return okEncoder();
          }),
          captureFrame: mock(async () => ({ buffer: Buffer.alloc(1) })),
          concat: mock(async () => ({ success: true as const })),
          closeSession: mock(async () => {}),
          removeFile: () => {},
        },
      }),
    ).rejects.toThrow(/ffmpeg missing/);
  });

  it("still falls back when a single worker cannot spawn its first encoder", async () => {
    let id = 0;
    let spawns = 0;
    const result = await runCaptureSegmentedStage({
      ...fakeStageInput({ totalFrames: 9 }),
      probeSession: null,
      segmentFrames: 3,
      segmentDir: join(fixtureRoot, "singlefallback"),
      workerCount: 1,
      sessionFactoryForWorker: () => ({ create: async () => fakeSession(id++) }),
      deps: {
        spawnEncoder: mock(async () => {
          if (spawns++ === 0) throw new Error("ffmpeg missing");
          return okEncoder();
        }),
        captureFrame: mock(async () => ({ buffer: Buffer.alloc(1) })),
        concat: mock(async () => ({ success: true as const })),
        closeSession: mock(async () => {}),
        removeFile: () => {},
      },
    });
    expect(result).toEqual({ success: false });
  });

  it("lets every worker stop before closing any session", async () => {
    // Closing a session out from under a worker that is still capturing
    // orphans its ffmpeg and races the CDP connection, so the stage waits for
    // all of them to settle even though one has already failed.
    let id = 0;
    let closedAny = false;
    let capturedAfterClose = 0;
    await expect(
      runCaptureSegmentedStage({
        ...fakeStageInput({ totalFrames: 9 }),
        probeSession: null,
        segmentFrames: 3,
        segmentDir: join(fixtureRoot, "settle"),
        workerCount: 3,
        sessionFactoryForWorker: () => ({ create: async () => fakeSession(id++) }),
        deps: {
          spawnEncoder: mock(async () => okEncoder()),
          captureFrame: mock(async (_s: unknown, i: number) => {
            if (closedAny) capturedAfterClose += 1;
            // Segment 0's first frame fails immediately; the other workers are
            // mid-flight on slow frames when it does.
            if (i === 0) throw new Error("media_start_out_of_range");
            await new Promise((r) => setTimeout(r, 5));
            return { buffer: Buffer.alloc(1) };
          }),
          concat: mock(async () => ({ success: true as const })),
          closeSession: mock(async () => {
            closedAny = true;
          }),
          removeFile: () => {},
        },
      }),
    ).rejects.toThrow(/media_start_out_of_range/);
    // Give any worker the stage abandoned time to resume and capture again;
    // without the wait this assertion passes before they would have.
    await new Promise((r) => setTimeout(r, 40));
    expect(capturedAfterClose).toBe(0);
  });
});
