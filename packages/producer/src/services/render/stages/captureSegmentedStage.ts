/**
 * Segmented capture (spec §5 Phase 2a).
 *
 * The frame range is split into fixed-size segments; each one gets its own
 * closed-GOP ffmpeg process writing `segments/segment_NNNNN.mp4`, and the
 * segments are concat-copied into the video-only file the assemble stage
 * muxes. Against the single-encoder streaming path this buys two things on a
 * long render: scratch is encoded video rather than one open pipe's worth of
 * in-flight state, and a failure is attributable to one segment — which is
 * what Phase 2b (resume) and 2c (per-segment retry) build on.
 *
 * This phase keeps ONE browser session for the whole render and no retry;
 * recycling and retry are 2c, multi-worker is 2d.
 */
import { existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  captureFrameToBuffer,
  closeCaptureSession,
  completeDeferredDrawElementInit,
  concatVideoFiles,
  createCaptureSession,
  getCapturePerfSummary,
  initializeSession,
  prepareCaptureSessionForReuse,
  resolveHeadlessShellPath,
  shouldDisableBrowserPoolForParallelWorker,
  spawnStreamingEncoder,
  type BeforeCaptureHook,
  type CaptureOptions,
  type CapturePerfSummary,
  type CaptureSession,
  type EngineConfig,
  type StreamingEncoder,
} from "@hyperframes/engine";
import type { FileServerHandle } from "../../fileServer.js";
import type { ProducerLogger } from "../../../logger.js";
import type { ProgressCallback, RenderJob } from "../../renderOrchestrator.js";
import { wrapCaptureStageError } from "../captureStageError.js";
import { ensureFrameWritten } from "./captureHdrFrameShared.js";
import { reportFrameProgress } from "../shared.js";
import { encoderFailureError } from "../encoderInterruption.js";
import type { SdrSegmentedCapturePlan } from "../capturePlan.js";
import { planSegments, type SegmentSlice } from "../segmentPlan.js";
import { createSegmentQueue } from "../segmentQueue.js";
import { isTargetLossError } from "../segmentRecycle.js";
import {
  raceAgainstStall,
  resolveCaptureStallTimeoutMs,
  type StreamingEncoderOptions,
} from "./captureStreamingStage.js";

export interface SegmentedStageDeps {
  spawnEncoder: typeof spawnStreamingEncoder;
  captureFrame: typeof captureFrameToBuffer;
  concat: typeof concatVideoFiles;
  closeSession: typeof closeCaptureSession;
  /** Delete a partial segment so a retry cannot leave a stale file behind. */
  removeFile: (path: string) => void;
}

/** Opens a fresh, initialized capture session with the video injector attached. */
export interface SessionFactory {
  create: () => Promise<CaptureSession>;
}

export interface CaptureSegmentedStageInput {
  fileServer: FileServerHandle;
  workDir: string;
  framesDir: string;
  videoOnlyPath: string;
  job: RenderJob;
  totalFrames: number;
  cfg: EngineConfig;
  plan: SdrSegmentedCapturePlan;
  log: ProducerLogger;
  probeSession: CaptureSession | null;
  /** For the spawn-failure log message context only. */
  outputFormat: string;
  streamingEncoderOptions: StreamingEncoderOptions;
  buildCaptureOptions: () => CaptureOptions;
  createRenderVideoFrameInjector: () => BeforeCaptureHook | null;
  abortSignal: AbortSignal | undefined;
  assertNotAborted: () => void;
  onProgress?: ProgressCallback;
  /** Mutated in place, same contract as the streaming stage. */
  dedupPerfs: CapturePerfSummary[];
  segmentFrames: number;
  /** Stable directory for segments; defaults to `${workDir}/segments`. */
  segmentDir?: string;
  /** Indices the caller already validated as reusable (Phase 2b resume). */
  completedSegments?: ReadonlySet<number>;
  /** Called after each segment closes, so the caller can persist a manifest. */
  onSegmentComplete?: (entry: {
    index: number;
    startFrame: number;
    endFrame: number;
    path: string;
    bytes: number;
  }) => void;
  /** Parallel capture sessions pulling from one segment queue. Default 1. */
  workerCount?: number;
  /** Per-worker factory; takes precedence over sessionFactory when set. */
  sessionFactoryForWorker?: (workerId: number) => SessionFactory;
  /**
   * Opens each session; defaults to reusing the probe session, then fresh
   * ones. Without sessionFactoryForWorker every worker shares this one
   * factory, so it must hand out a distinct session per create() call, as
   * the default does; a factory that returns one shared session would have N
   * workers driving one browser.
   */
  sessionFactory?: SessionFactory;
  /** Recycle the browser every N segments; 0 or absent keeps one session. */
  browserRecycleEverySegments?: number;
  /** Test seam; defaults to the real engine functions. */
  deps?: Partial<SegmentedStageDeps>;
  updateCaptureObservability?: (patch: {
    capturePath?: "segmented";
    segmentIndex?: number;
    segmentRetries?: number;
  }) => void;
}

export type CaptureSegmentedStageResult =
  | {
      success: true;
      encodeMs: number;
      probeSession: null;
      lastBrowserConsole: string[];
      workerCount: number;
      segments: number;
      segmentPaths: string[];
      /** Segments re-captured after a Chrome target loss. */
      segmentRetries: number;
      /** Cadence-driven browser restarts (retries are counted separately). */
      browserRecycles: number;
    }
  /** The first segment's encoder could not spawn — caller replans to sdr_streaming. */
  | { success: false };

/** Zero-padded so lexical order equals frame order in the concat list and on disk. */
export function segmentOutputPath(segmentDir: string, index: number): string {
  return join(segmentDir, `segment_${String(index).padStart(5, "0")}.mp4`);
}

/**
 * One closed-GOP encoder per segment. `gopSize` is the segment's own frame
 * count so the segment is exactly one GOP and concat-copy has an IDR at every
 * boundary; without it ffmpeg picks its own keyframes and a boundary can land
 * mid-GOP, which decodes as a glitch rather than an error.
 */
function segmentEncoderOptions(
  base: StreamingEncoderOptions,
  segment: SegmentSlice,
): StreamingEncoderOptions {
  return {
    ...base,
    lockGopForChunkConcat: true,
    gopSize: segment.endFrame - segment.startFrame,
  };
}

/** A segment's encoder never started. Only segment 0 can still fall back. */
class SegmentEncoderSpawnError extends Error {
  readonly reason: unknown;

  constructor(reason: unknown) {
    super(reason instanceof Error ? reason.message : String(reason));
    this.name = "SegmentEncoderSpawnError";
    this.reason = reason;
  }
}

interface SegmentCaptureContext {
  session: CaptureSession;
  job: RenderJob;
  cfg: EngineConfig;
  totalFrames: number;
  segmentCount: number;
  segmentDir: string;
  skipped: number;
  streamingEncoderOptions: StreamingEncoderOptions;
  spawnEncoder: SegmentedStageDeps["spawnEncoder"];
  captureFrame: SegmentedStageDeps["captureFrame"];
  stallTimeoutMs: number;
  abortSignal: AbortSignal | undefined;
  assertNotAborted: () => void;
  onProgress?: ProgressCallback;
  onSegmentComplete?: CaptureSegmentedStageInput["onSegmentComplete"];
}

/** The segment's frames, in order, into an already-spawned encoder. */
async function captureSegmentFrames(
  ctx: SegmentCaptureContext,
  segment: SegmentSlice,
  encoder: StreamingEncoder,
): Promise<void> {
  let lastProgressAt = Date.now();
  for (let i = segment.startFrame; i < segment.endFrame; i++) {
    ctx.assertNotAborted();
    const time = (i * ctx.job.config.fps.den) / ctx.job.config.fps.num;
    const { buffer } = await raceAgainstStall(
      ctx.captureFrame(ctx.session, i, time),
      ctx.stallTimeoutMs - (Date.now() - lastProgressAt),
      {
        captureMode: ctx.session.captureMode,
        frameIndex: i,
        totalFrames: ctx.totalFrames,
        stallTimeoutMs: ctx.stallTimeoutMs,
      },
      ctx.abortSignal,
    );
    ensureFrameWritten(await encoder.writeFrame(buffer), i, encoder);
    ctx.job.framesRendered = i + 1;
    lastProgressAt = Date.now();

    reportFrameProgress(
      ctx.job,
      `Streaming frame ${i + 1}/${ctx.totalFrames} (segment ${segment.index + 1}/${ctx.segmentCount}` +
        (ctx.skipped > 0 ? `, skipped ${ctx.skipped}` : "") +
        ")",
      Math.round(25 + ((i + 1) / ctx.totalFrames) * 55),
      ctx.onProgress,
      i + 1 === ctx.totalFrames,
    );
  }
}

/** Capture one segment into its own encoder. Returns the encoder's encode ms. */
async function captureSegment(ctx: SegmentCaptureContext, segment: SegmentSlice): Promise<number> {
  const segmentPath = segmentOutputPath(ctx.segmentDir, segment.index);
  let encoder: StreamingEncoder;
  try {
    encoder = await ctx.spawnEncoder(
      segmentPath,
      segmentEncoderOptions(ctx.streamingEncoderOptions, segment),
      ctx.abortSignal,
      ctx.cfg,
    );
    ctx.assertNotAborted();
  } catch (err) {
    if (ctx.abortSignal?.aborted) throw err;
    throw new SegmentEncoderSpawnError(err);
  }

  let encoderClosed = false;
  try {
    await captureSegmentFrames(ctx, segment, encoder);
    const encodeResult = await encoder.close();
    encoderClosed = true;
    if (!encodeResult.success) {
      throw encoderFailureError(`Segment ${segment.index} encode failed`, encodeResult);
    }
    ctx.onSegmentComplete?.({
      index: segment.index,
      startFrame: segment.startFrame,
      endFrame: segment.endFrame,
      path: segmentPath,
      // Recorded so resume can prove the file on disk is the one that
      // finished; absent only in unit tests, whose fake encoder writes none.
      bytes: existsSync(segmentPath) ? statSync(segmentPath).size : 0,
    });
    return encodeResult.durationMs;
  } finally {
    // A throw above (capture failure, abort, write error) leaves ffmpeg
    // running; close() is idempotent so this is safe next to the success
    // path's close.
    if (!encoderClosed) {
      await encoder.close().catch(() => {});
    }
  }
}

const DEFAULT_DEPS: SegmentedStageDeps = {
  spawnEncoder: spawnStreamingEncoder,
  captureFrame: captureFrameToBuffer,
  concat: concatVideoFiles,
  // Through the import binding, not captured: a value captured at module load
  // is invisible to a test that swaps the engine module after this file has
  // been evaluated (bun updates live bindings, not copies).
  closeSession: (session) => closeCaptureSession(session),
  removeFile: (path) => rmSync(path, { force: true }),
};

/**
 * Default factory: the probe session is consumed by the first call, every
 * later one opens a fresh browser. Initialization happens here so a recycled
 * session is indistinguishable from the first.
 */
function defaultSessionFactory(input: CaptureSegmentedStageInput): SessionFactory {
  let probeSession = input.probeSession;
  return {
    create: async () => {
      const session = probeSession ?? (await openSegmentedSession(input));
      if (probeSession) {
        openSegmentedSessionReuse(input, probeSession);
        probeSession = null;
      }
      try {
        if (!session.isInitialized) await initializeSession(session);
        await completeDeferredDrawElementInit(session);
      } catch (error) {
        await closeCaptureSession(session).catch(() => {});
        throw error;
      }
      return session;
    },
  };
}

function openSegmentedSessionReuse(
  input: CaptureSegmentedStageInput,
  session: CaptureSession,
): void {
  prepareCaptureSessionForReuse(session, input.framesDir, input.createRenderVideoFrameInjector());
}

async function openSegmentedSession(input: CaptureSegmentedStageInput): Promise<CaptureSession> {
  // Same reasoning as the streaming stage: the resolved forceScreenshot comes
  // from the immutable plan, not from the caller-owned cfg.
  const captureCfg: EngineConfig =
    input.cfg.forceScreenshot === input.plan.forceScreenshot
      ? input.cfg
      : { ...input.cfg, forceScreenshot: input.plan.forceScreenshot };
  const videoInjector = input.createRenderVideoFrameInjector();
  const captureOptions = input.buildCaptureOptions();
  const ownBrowser = shouldDisableBrowserPoolForParallelWorker({
    parallel: (input.workerCount ?? 1) > 1,
    platform: process.platform,
    deviceScaleFactor: captureOptions.deviceScaleFactor,
    headlessShellPath: resolveHeadlessShellPath(captureCfg),
  });
  return createCaptureSession(
    input.fileServer.url,
    input.framesDir,
    captureOptions,
    videoInjector,
    ownBrowser ? { ...captureCfg, enableBrowserPool: false } : captureCfg,
  );
}

/** Stream-copy the finished segments into the video-only file, or throw. */
async function concatSegments(
  concat: SegmentedStageDeps["concat"],
  segmentPaths: readonly string[],
  videoOnlyPath: string,
  abortSignal: AbortSignal | undefined,
  cfg: EngineConfig,
): Promise<void> {
  const result = await concat(segmentPaths, videoOnlyPath, abortSignal, cfg);
  if (result.success) return;
  throw encoderFailureError("Segment concat failed", {
    error: result.error,
    failureReason: result.externalInterruption ? "external_interruption" : undefined,
  });
}

interface SegmentWorker {
  id: number;
  ctx: SegmentCaptureContext;
  sessionSegments: number;
  factory: SessionFactory;
}

/** Counters shared by every worker; JS is single-threaded, so += is safe. */
interface SegmentTotals {
  encodeMs: number;
  segmentRetries: number;
  browserRecycles: number;
}

/** Everything the per-worker helpers need, resolved once. */
interface SegmentRun {
  input: CaptureSegmentedStageInput;
  deps: SegmentedStageDeps;
  totals: SegmentTotals;
  segments: readonly SegmentSlice[];
  pending: readonly SegmentSlice[];
  segmentDir: string;
  skipSize: number;
  workerCount: number;
  recycleEvery: number;
  /** One for all workers, so only the first create() takes the probe session. */
  sessionFactory: SessionFactory;
}

async function createSegmentWorker(run: SegmentRun, id: number): Promise<SegmentWorker> {
  const { input, deps } = run;
  const factory = input.sessionFactoryForWorker?.(id) ?? run.sessionFactory;
  return {
    id,
    factory,
    sessionSegments: 0,
    ctx: {
      session: await factory.create(),
      job: input.job,
      cfg: input.cfg,
      totalFrames: input.totalFrames,
      segmentCount: run.segments.length,
      segmentDir: run.segmentDir,
      skipped: run.skipSize,
      streamingEncoderOptions: input.streamingEncoderOptions,
      spawnEncoder: deps.spawnEncoder,
      captureFrame: deps.captureFrame,
      stallTimeoutMs: resolveCaptureStallTimeoutMs(),
      abortSignal: input.abortSignal,
      assertNotAborted: input.assertNotAborted,
      onProgress: input.onProgress,
      onSegmentComplete: input.onSegmentComplete,
    },
  };
}

/** Close this worker's browser and open a fresh one at a segment boundary. */
async function recycleWorkerSession(
  run: SegmentRun,
  worker: SegmentWorker,
  why: "cadence" | "retry",
): Promise<void> {
  // Counters are only valid while the session is live, so harvest before close.
  run.input.dedupPerfs.push(getCapturePerfSummary(worker.ctx.session));
  const memory = worker.ctx.session.chromeMemory?.stats();
  await run.deps.closeSession(worker.ctx.session);
  worker.ctx.session = await worker.factory.create();
  worker.sessionSegments = 0;
  if (why === "cadence") run.totals.browserRecycles += 1;
  run.input.log.info(`[Render] segment browser recycled (${why})`, {
    worker: worker.id,
    rendererRssPeakMb: memory?.rendererRssPeakMb,
    rssLastMb: memory?.rssLastMb,
    samples: memory?.samples,
  });
}

/**
 * The encoder never started. Only a single-worker render can still fall back:
 * with several workers in flight, other segments are already being encoded
 * and a fallback would throw their work away.
 */
function onSegmentSpawnFailure(
  run: SegmentRun,
  err: SegmentEncoderSpawnError,
  segment: SegmentSlice,
): "fallback" {
  if (run.workerCount > 1 || segment.index !== run.pending[0]?.index) throw err.reason;
  run.input.log.warn(
    "[Render] Segment encoder spawn failed; falling back to single-encoder streaming.",
    {
      error: err.message,
      outputFormat: run.input.outputFormat,
      segments: run.segments.length,
      durationSeconds: run.input.job.duration,
    },
  );
  return "fallback";
}

/**
 * Chrome losing its target mid-capture is the one failure a fresh browser
 * fixes; everything else reproduces, so retrying it only doubles the time to
 * the same error. Once, then it propagates.
 */
async function retryAfterTargetLoss(
  run: SegmentRun,
  worker: SegmentWorker,
  err: unknown,
  segment: SegmentSlice,
  segmentPath: string,
): Promise<void> {
  if (!isTargetLossError(err) || run.input.abortSignal?.aborted) throw err;
  run.totals.segmentRetries += 1;
  run.input.updateCaptureObservability?.({ segmentRetries: run.totals.segmentRetries });
  run.input.log.warn(
    `[Render] segment ${segment.index}: browser target lost; retrying once on a fresh session`,
    { worker: worker.id, error: err instanceof Error ? err.message : String(err) },
  );
  run.deps.removeFile(segmentPath);
  // Side effect worth knowing: recycling resets the worker's sessionSegments,
  // so a retry also restarts the cadence clock. Intended: the fresh browser
  // is as new as a cadence restart would have made it.
  await recycleWorkerSession(run, worker, "retry");
  run.totals.encodeMs += await captureSegment(worker.ctx, segment);
}

async function runOneSegment(
  run: SegmentRun,
  worker: SegmentWorker,
  segment: SegmentSlice,
): Promise<"done" | "fallback"> {
  const segmentPath = segmentOutputPath(run.segmentDir, segment.index);
  if (run.recycleEvery > 0 && worker.sessionSegments >= run.recycleEvery) {
    await recycleWorkerSession(run, worker, "cadence");
  }
  run.input.updateCaptureObservability?.({
    capturePath: "segmented",
    segmentIndex: segment.index,
  });
  try {
    run.totals.encodeMs += await captureSegment(worker.ctx, segment);
  } catch (err) {
    if (err instanceof SegmentEncoderSpawnError) return onSegmentSpawnFailure(run, err, segment);
    await retryAfterTargetLoss(run, worker, err, segment, segmentPath);
  }
  worker.sessionSegments += 1;
  return "done";
}

/**
 * A full resume hit: nothing to capture, so no browser round-trip. The probe
 * the orchestrator handed in is still ours to close, as the worker finally
 * would have done.
 */
async function concatResumedRun(
  run: SegmentRun,
  segmentPaths: string[],
): Promise<CaptureSegmentedStageResult> {
  const { input, deps } = run;
  input.log.info("[Render] every segment already complete (resume); concatenating without capture");
  if (input.probeSession) await deps.closeSession(input.probeSession);
  await concatSegments(
    deps.concat,
    segmentPaths,
    input.videoOnlyPath,
    input.abortSignal,
    input.cfg,
  );
  return {
    success: true,
    encodeMs: 0,
    probeSession: null,
    lastBrowserConsole: [],
    workerCount: run.workerCount,
    segments: run.segments.length,
    segmentPaths,
    segmentRetries: 0,
    browserRecycles: 0,
  };
}

export async function runCaptureSegmentedStage(
  input: CaptureSegmentedStageInput,
): Promise<CaptureSegmentedStageResult> {
  const { log, dedupPerfs, assertNotAborted } = input;
  const deps: SegmentedStageDeps = { ...DEFAULT_DEPS, ...input.deps };

  const segments = planSegments(input.totalFrames, input.segmentFrames);
  const segmentDir = input.segmentDir ?? join(input.workDir, "segments");
  mkdirSync(segmentDir, { recursive: true });
  const skip = input.completedSegments ?? new Set<number>();
  const pending = segments.filter((s) => !skip.has(s.index));
  for (const index of skip) log.info("[Render] segment skipped (resume)", { index });
  const run: SegmentRun = {
    input,
    deps,
    totals: { encodeMs: 0, segmentRetries: 0, browserRecycles: 0 },
    segments,
    pending,
    segmentDir,
    skipSize: skip.size,
    workerCount: Math.max(1, input.workerCount ?? 1),
    recycleEvery: input.browserRecycleEverySegments ?? 0,
    sessionFactory: input.sessionFactory ?? defaultSessionFactory(input),
  };
  const queue = createSegmentQueue(pending);
  // Built from the plan, not from completion order: workers finish out of
  // order, so the concat list must not depend on who finished when.
  const segmentPaths = segments.map((s) => segmentOutputPath(segmentDir, s.index));
  if (pending.length === 0) return concatResumedRun(run, segmentPaths);
  let fellBackToStreaming = false;

  const workers: SegmentWorker[] = [];
  const consoleOf = () => workers[0]?.ctx.session.browserConsoleBuffer ?? [];
  let lastBrowserConsole: string[] = [];

  /** Pull segments until the queue drains, another worker failed, or we fell back. */
  const runWorkerLoop = async (worker: SegmentWorker): Promise<void> => {
    for (;;) {
      if (fellBackToStreaming) return;
      assertNotAborted();
      const segment = queue.next();
      if (!segment) return;
      if ((await runOneSegment(run, worker, segment)) === "fallback") {
        fellBackToStreaming = true;
        return;
      }
    }
  };

  try {
    assertNotAborted();
    for (let id = 0; id < run.workerCount; id++) workers.push(await createSegmentWorker(run, id));
    // allSettled, not all: closing a session out from under a worker that is
    // still capturing orphans its ffmpeg and races the CDP connection, so
    // every worker has to stop before the finally runs. The first error is
    // rethrown below.
    const outcomes = await Promise.allSettled(workers.map((w) => runWorkerLoop(w)));
    for (const worker of workers) dedupPerfs.push(getCapturePerfSummary(worker.ctx.session));
    const failure = outcomes.find((o) => o.status === "rejected");
    if (failure && failure.status === "rejected") throw failure.reason;
  } catch (error) {
    lastBrowserConsole = consoleOf();
    throw wrapCaptureStageError(error, lastBrowserConsole);
  } finally {
    lastBrowserConsole = consoleOf();
    for (const worker of workers) await deps.closeSession(worker.ctx.session);
  }

  if (fellBackToStreaming) return { success: false };

  await concatSegments(
    deps.concat,
    segmentPaths,
    input.videoOnlyPath,
    input.abortSignal,
    input.cfg,
  );

  return {
    success: true,
    encodeMs: run.totals.encodeMs,
    probeSession: null,
    lastBrowserConsole,
    workerCount: run.workerCount,
    segments: segments.length,
    segmentPaths,
    segmentRetries: run.totals.segmentRetries,
    browserRecycles: run.totals.browserRecycles,
  };
}
