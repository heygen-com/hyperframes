import { afterEach, beforeEach, expect, it, onTestFinished, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveConfig, type WorkerTask } from "@hyperframes/engine";
import { formatCaptureFrameName } from "../utils/paths.js";
import { createRenderJob, executeRenderJob, type ProgressCallback } from "./renderOrchestrator.js";
import { OrderedRenderEventPublisher } from "./render/renderEventPublisher.js";

// Entry: executeRenderJob with the real disk capture stage and retry ladder. Each parallel attempt is
// scripted: "stall" lands three frames then hangs until its signal aborts; a pace lands every frame.
type AttemptScript =
  | "stall"
  | "spread"
  | { firstFrameAfterMs: number; frameEveryMs: number; tailMs?: number };
const capture = vi.hoisted(() => ({
  scripts: [] as AttemptScript[],
  calls: 0,
  retriedWithWorkers: [] as number[],
  hdrSignal: undefined as AbortSignal | undefined,
  workerCount: 4,
  shaderTransitions: false,
  blocked: 0,
}));

// The 250 ms memory sampler is a faked interval: left running it is the next timer on every jump.
vi.mock("./render/shared.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./render/shared.js")>()),
  createMemorySampler: () => ({
    peakRssBytes: () => 0,
    peakHeapUsedBytes: () => 0,
    stop: () => {},
  }),
}));

type ScriptedFrame = { dir: string; index: number };

function listFrames(tasks: WorkerTask[]): ScriptedFrame[] {
  return tasks.flatMap((task) =>
    Array.from({ length: task.endFrame - task.startFrame }, (_, i) => ({
      dir: task.outputDir,
      index: task.startFrame + i,
    })),
  );
}

// "spread" lands the first frame of each worker's range, leaving four missing ranges.
function landedFrames(script: AttemptScript, frames: ScriptedFrame[]): ScriptedFrame[] {
  if (script === "spread") return frames.filter((frame) => frame.index % 10 === 0);
  return frames.slice(0, script === "stall" ? 3 : frames.length);
}

function writeFrame(frame: ScriptedFrame, extension: string): void {
  mkdirSync(frame.dir, { recursive: true });
  writeFileSync(
    join(frame.dir, formatCaptureFrameName(frame.index, extension)),
    "frame bytes over the 8-byte placeholder floor",
  );
}

function neverSettlesUntilAborted(signal: AbortSignal): Promise<never> {
  return block(
    new Promise<never>((_, reject) =>
      signal?.addEventListener("abort", () => reject(new Error("worker cancelled")), {
        once: true,
      }),
    ),
  );
}

/** Holds the scripted attempt on `pending`; fake time only advances while an attempt is held. */
async function block<T>(pending: Promise<T>): Promise<T> {
  capture.blocked += 1;
  try {
    return await pending;
  } finally {
    capture.blocked -= 1;
  }
}

function wait(ms: number): Promise<unknown> {
  return block(new Promise((resolve) => setTimeout(resolve, ms)));
}

async function landFrame(
  frame: ScriptedFrame,
  extension: string,
  delayMs: number,
  signal: AbortSignal,
): Promise<void> {
  await wait(delayMs);
  if (signal?.aborted) throw new Error("worker cancelled");
  writeFrame(frame, extension);
}

/** Work after the last frame (closing workers, flushing) does not watch the abort. */
async function holdTail(script: AttemptScript): Promise<void> {
  if (typeof script === "object" && script.tailMs) await wait(script.tailMs);
}

async function runScriptedAttempt(
  tasks: WorkerTask[],
  extension: string,
  signal: AbortSignal,
  onProgress: (progress: object) => void,
): Promise<[]> {
  capture.calls += 1;
  const script = capture.scripts.shift() ?? "stall";
  const pace = typeof script === "object" ? script : null;
  const frames = listFrames(tasks);
  let captured = 0;
  for (const frame of landedFrames(script, frames)) {
    const delayMs = pace && captured === 0 ? pace.firstFrameAfterMs : 1_000;
    await landFrame(frame, extension, delayMs, signal);
    captured += 1;
    onProgress({ capturedFrames: captured, totalFrames: frames.length, activeWorkers: 1 });
    if (pace) await wait(pace.frameEveryMs - 1_000);
  }
  if (!pace) await neverSettlesUntilAborted(signal);
  await holdTail(script);
  return [];
}

vi.mock("@hyperframes/engine", async (importOriginal) => {
  const engine = await importOriginal<typeof import("@hyperframes/engine")>();
  return {
    ...engine,
    assertConfiguredFfmpegBinariesExist: () => {},
    resolveBrowserGpuMode: async () => "software",
    createCaptureSession: async () => ({ browserConsoleBuffer: [], options: {} }),
    initializeSession: async () => {},
    closeCaptureSession: async () => {},
    verifyDiskDrawElementSamples: async () => {},
    getCapturePerfSummary: () => ({}),
    // Sequential disk: three quick frames, then every frame takes 70 s.
    captureFrame: (_session: unknown, index: number) => wait(index < 3 ? 1_000 : 70_000),
    executeParallelCapture: (
      _url: string,
      _workDir: string,
      tasks: WorkerTask[],
      options: { format?: "jpeg" | "png" },
      _hook: unknown,
      signal: AbortSignal,
      onProgress: (progress: object) => void,
    ) => runScriptedAttempt(tasks, engine.frameFileExtension(options.format), signal, onProgress),
  };
});
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
      hasShaderTransitions: capture.shaderTransitions,
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
  resolveRenderWorkerCount: () => capture.workerCount,
}));
vi.mock("./render/stages/captureHdrStage.js", () => ({
  runCaptureHdrStage: (input: { abortSignal: AbortSignal }) => {
    capture.hdrSignal = input.abortSignal;
    return block(new Promise<never>(() => {}));
  },
}));
vi.mock("./render/stages/encodeStage.js", () => ({
  canEncodeWhileCapturing: () => false,
  runEncodeStage: async ({ outputPath }: { outputPath: string }) => {
    mkdirSync(outputPath, { recursive: true });
    for (let frame = 1; frame <= 40; frame++) {
      writeFileSync(join(outputPath, formatCaptureFrameName(frame, "png")), "encoded");
    }
    return { encodeMs: 0 };
  },
}));
vi.mock("./render/perfSummary.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./render/perfSummary.js")>()),
  buildRenderPerfSummary: (..._args: unknown[]) => ({}),
}));

const PENDING = Symbol("pending");
const dirs: string[] = [];
// A test over SLOW_TEST_MS prints where its real time went, so a slow CI run names the step.
const SLOW_TEST_MS = 2_000;
const spent = new Map<string, number>();
let testStarted = 0;
let budgetRanOut = 0;
async function timed<T>(step: string, run: () => Promise<T>): Promise<T> {
  const started = performance.now();
  try {
    return await run();
  } finally {
    spent.set(step, (spent.get(step) ?? 0) + performance.now() - started);
  }
}
beforeEach(() => {
  spent.clear();
  testStarted = performance.now();
  budgetRanOut = 0;
  capture.scripts = [];
  capture.calls = 0;
  capture.retriedWithWorkers = [];
  capture.hdrSignal = undefined;
  capture.shaderTransitions = false;
  capture.workerCount = 4;
  capture.blocked = 0;
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
  });
});
afterEach((context) => {
  const total = performance.now() - testStarted;
  if (total > SLOW_TEST_MS) {
    const steps = [...spent].map(([step, ms]) => `${step} ${Math.round(ms)} ms`).join(", ");
    console.warn(`[stall test] ${context.task.name}: ${Math.round(total)} ms (${steps})`);
  }
  vi.useRealTimers();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Starts a render; `outcome()` is "completed", the thrown error, or PENDING. */
function startRender(
  progressSink?: ProgressCallback,
  format: "png-sequence" | "mp4" = "png-sequence",
): () => unknown {
  const root = mkdtempSync(join(tmpdir(), "hf-stage-stall-"));
  dirs.push(root);
  writeFileSync(join(root, "index.html"), "<div></div>");
  const job = createRenderJob({
    fps: 30,
    quality: "draft",
    format,
    hdrMode: "force-sdr",
    producerConfig: resolveConfig({ enablePageSideCompositing: false }),
    logger: {
      info() {},
      error() {},
      debug() {},
      warn(message: string, meta?: Record<string, unknown>) {
        if (message.includes("retrying missing frames")) {
          capture.retriedWithWorkers.push(meta?.toWorkers as number);
        }
      },
    },
  });
  let settled: unknown = PENDING;
  void executeRenderJob(job, root, join(root, "frames"), progressSink).then(
    () => (settled = "completed"),
    (error: unknown) => (settled = error),
  );
  return () => settled;
}

async function ioTurns(): Promise<void> {
  for (let turn = 0; turn < 50; turn++) await new Promise((resolve) => setImmediate(resolve));
}

/** Real file IO after the last frame takes a varying number of turns: wait for the render to settle. */
async function settled(outcome: () => unknown): Promise<unknown> {
  await timed("settle", async () => {
    for (let turn = 0; turn < 20_000 && outcome() === PENDING; turn++) {
      await new Promise((resolve) => setImmediate(resolve));
    }
  });
  return outcome();
}

/** Real file IO outlasts any fixed number of turns on a slow host: wait, within a budget, until an attempt is held. */
async function untilHeld(outcome: () => unknown, budget: { ms: number }): Promise<void> {
  const started = performance.now();
  while (
    outcome() === PENDING &&
    capture.blocked === 0 &&
    performance.now() - started < budget.ms
  ) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  budget.ms -= performance.now() - started;
  if (outcome() === PENDING && capture.blocked === 0) budgetRanOut += 1;
}

/** Jumps fake time to the next timer while the scripted attempt waits, with real IO between steps. */
async function runFor(ms: number, outcome: () => unknown): Promise<void> {
  const budget = { ms: 1_000 };
  await timed("wait for held", () => untilHeld(outcome, budget));
  for (let elapsed = 0; elapsed < ms && outcome() === PENDING; ) {
    await timed("io turns", ioTurns);
    await timed("wait for held", () => untilHeld(outcome, budget));
    const before = Date.now();
    await timed("advance timers", () => vi.advanceTimersToNextTimerAsync());
    const jumped = Date.now() - before;
    if (jumped > 0) elapsed += jumped;
    else {
      await timed("advance timers", () => vi.advanceTimersByTimeAsync(1_000));
      elapsed += 1_000;
    }
  }
  await timed("io turns", ioTurns);
}

it("retries a stalled attempt on fewer workers, with a fresh window, and the render completes", async () => {
  capture.scripts = ["stall", { firstFrameAfterMs: 200_000, frameEveryMs: 1_000 }];
  const outcome = startRender();
  await runFor(400_000, outcome);
  expect(capture.retriedWithWorkers).toEqual([2]);
  expect(await settled(outcome)).toBe("completed");
});

it("gives each retry batch its own first-frame window", async () => {
  // Four missing ranges on two workers: two batches; the second pool lands its first frame after 100 s.
  capture.scripts = [
    "spread",
    { firstFrameAfterMs: 1_000, frameEveryMs: 1_000 },
    { firstFrameAfterMs: 100_000, frameEveryMs: 1_000 },
  ];
  const outcome = startRender();
  await runFor(600_000, outcome);
  expect(capture.retriedWithWorkers).toEqual([2]);
  expect(capture.calls).toBe(3);
  expect(await settled(outcome)).toBe("completed");
});

it("fails typed and non-retryable once every attempt down the ladder stalls", async () => {
  const outcome = startRender();
  await runFor(3 * (3_000 + 60_000 + 5_000) + 10_000, outcome);
  expect(capture.retriedWithWorkers).toEqual([2, 1]);
  expect(outcome()).toMatchObject({
    name: "RenderStageStalledError",
    code: "RENDER_STAGE_STALLED",
    owner: "system",
    retryable: false,
  });
});

it("never kills a capture that keeps landing frames", async () => {
  capture.scripts = [{ firstFrameAfterMs: 250_000, frameEveryMs: 50_000 }];
  const outcome = startRender();
  await runFor(250_000 + 40 * 50_000 + 10_000, outcome);
  expect(capture.calls).toBe(1);
  expect(await settled(outcome)).toBe("completed");
});

it("fails a sequential disk capture at the first frame after its window ran out", async () => {
  capture.workerCount = 1;
  const outcome = startRender();
  await runFor(3_000 + 70_000 + 5_000, outcome);
  expect(outcome()).toMatchObject({ code: "RENDER_STAGE_STALLED", retryable: false });
});

it("fails an HDR capture that stops, the only attempt it has, and aborts that attempt", async () => {
  capture.shaderTransitions = true;
  const outcome = startRender(undefined, "mp4");
  await runFor(300_000 + 10_000, outcome);
  expect(capture.hdrSignal?.aborted).toBe(true);
  await runFor(60_000 + 10_000, outcome);
  expect(outcome()).toMatchObject({ code: "RENDER_STAGE_STALLED" });
});

it("does not fail a capture that landed every frame for the work that follows its last frame", async () => {
  capture.scripts = [{ firstFrameAfterMs: 1_000, frameEveryMs: 1_000, tailMs: 130_000 }];
  const outcome = startRender();
  await runFor(40 * 1_000 + 130_000 + 10_000, outcome);
  expect(capture.retriedWithWorkers).toEqual([]);
  expect(await settled(outcome)).toBe("completed");
});

it("still fails a capture whose tail outlasts the tail budget", async () => {
  capture.scripts = [{ firstFrameAfterMs: 1_000, frameEveryMs: 1_000, tailMs: 700_000 }];
  const outcome = startRender();
  await runFor(40 * 1_000 + 2 * 300_000 + 20_000, outcome);
  expect(outcome()).toMatchObject({ code: "RENDER_STAGE_STALLED", retryable: false });
});

it("completes even when the progress sink never drains", async () => {
  capture.scripts = [{ firstFrameAfterMs: 1_000, frameEveryMs: 1_000 }];
  const sinkNeverDrains: ProgressCallback = () => new Promise<void>(() => {});
  // The render then waits out the flush's fake timeout: held, so fake time jumps to it at once.
  const flush = OrderedRenderEventPublisher.prototype.flush;
  const held = vi
    .spyOn(OrderedRenderEventPublisher.prototype, "flush")
    .mockImplementation(function (this: OrderedRenderEventPublisher) {
      return block(flush.call(this));
    });
  onTestFinished(() => held.mockRestore());
  const outcome = startRender(sinkNeverDrains);
  await runFor(120_000, outcome);
  expect(await settled(outcome)).toBe("completed");
  expect(budgetRanOut).toBe(0);
});
