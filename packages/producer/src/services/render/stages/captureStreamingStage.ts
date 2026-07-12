// fallow-ignore-file code-duplication complexity
/**
 * captureStreamingStage — single-machine fused capture + encode path.
 *
 * Streaming mode pipes captured frame buffers directly into ffmpeg's stdin
 * via `spawnStreamingEncoder`, skipping disk writes and the separate
 * Stage 5 encode step. In effect, Stage 4 (capture) absorbs Stage 5
 * (encode) for renders that fit the single-machine fusion path.
 *
 * The streaming path is gated by `shouldUseStreamingEncode(...)` upstream:
 *   - Disabled when output is png-sequence (no encoder).
 *   - Disabled for parallel renders auto-selected by calibration where the
 *     ordered streaming writer would stall later workers behind earlier
 *     ranges (the orchestrator decides this; the stage is told via input).
 *   - Disabled in distributed mode (which writes chunks to disk).
 *
 * If `spawnStreamingEncoder` fails for any non-abort reason, the stage
 * returns `{ success: false }` and the sequencer falls back to the disk
 * capture path. This mirrors the original orchestrator's flag-flip
 * (`useStreamingEncode = false`).
 *
 * Hard constraints preserved verbatim from the in-process renderer:
 *   - `probeSession` is closed when the parallel path takes over, OR in
 *     the sequential session's `finally`. Either way the local binding
 *     is nulled and the result returns the updated value.
 *   - `lastBrowserConsole` is set to the buffer of whichever session
 *     was active last (probe close path, or sequential session finally).
 *   - `job.framesRendered` is updated per-frame; `Streaming frame N/M`
 *     `updateJobStatus` payloads fire at the same 30-frame and
 *     completion checkpoints (parallel) or every frame (sequential).
 *   - Encoder close + result inspection happens inside the stage; a
 *     `Streaming encode failed: ...` error throws on `success: false`.
 *   - Defensive cleanup of `streamingEncoder` happens in the stage's
 *     own `finally` regardless of success/failure, gated on
 *     `streamingEncoderClosed` so it's idempotent.
 *
 * Known follow-up (same as captureStage): this stage imports
 * `updateJobStatus` from `renderOrchestrator.ts`, forming a runtime
 * cycle with the orchestrator's import of `runCaptureStreamingStage`.
 * Safe at runtime; a subsequent change will move the capture helpers
 * into a shared module so the stages can import without reaching back.
 */

import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  type BeforeCaptureHook,
  type CaptureOptions,
  type CapturePerfSummary,
  type CaptureSession,
  type EngineConfig,
  type StreamingEncoder,
  DrawElementVerificationError,
  captureFrameToBuffer,
  captureFrameToBufferPipelined,
  captureFramesBatchPipelined,
  closeCaptureSession,
  createCaptureSession,
  createFrameReorderBuffer,
  distributeFrames,
  distributeFramesInterleaved,
  executeParallelCapture,
  getCapturePerfSummary,
  getFfmpegBinary,
  recaptureDrawElementFrameForVerify,
  completeDeferredDrawElementInit,
  initializeSession,
  prepareCaptureSessionForReuse,
  spawnStreamingEncoder,
} from "@hyperframes/engine";
import type { FileServerHandle } from "../../fileServer.js";
import type { ProducerLogger } from "../../../logger.js";
import type { ProgressCallback, RenderJob } from "../../renderOrchestrator.js";
import { wrapCaptureStageError } from "../captureStageError.js";
import { pushWorkerDedupPerfs } from "../perfSummary.js";
import { ensureFrameWritten } from "./captureHdrFrameShared.js";
import { updateJobStatus } from "../shared.js";

/**
 * Pre-built ffmpeg streaming-encoder options, exactly matching the
 * second argument to `spawnStreamingEncoder`. The sequencer constructs
 * this from its in-scope preset / dimensions / quality fields and
 * passes it through so the stage doesn't have to reach back for the
 * preset's internal shape.
 */
export type StreamingEncoderOptions = Parameters<typeof spawnStreamingEncoder>[1];

export interface CaptureStreamingStageInput {
  fileServer: FileServerHandle;
  workDir: string;
  framesDir: string;
  videoOnlyPath: string;
  job: RenderJob;
  /**
   * `job.totalFrames` is `number | undefined` in the public type — the
   * sequencer narrows it via the probeStage result before calling here.
   */
  totalFrames: number;
  cfg: EngineConfig;
  /**
   * Capture-mode flag threaded from `compileStage`. The stage derives a
   * local copy of `cfg` with this value applied to `forceScreenshot`
   * before any engine call, so the caller-owned `cfg` is never mutated.
   * The sequencer may override `compileResult.forceScreenshot` after a
   * BeginFrame calibration timeout — passing the override through this
   * parameter keeps the decision visible at the call site instead of
   * hiding it inside a shared mutable config.
   */
  forceScreenshot: boolean;
  log: ProducerLogger;
  workerCount: number;
  probeSession: CaptureSession | null;
  /**
   * Per-render override from the DE parallel router — see
   * deParallelStreamForced's declaration in renderOrchestrator.ts. Distinct
   * from the `HF_DE_PARALLEL_STREAM` manual opt-in (still read directly by
   * this stage) because the router's decision must not leak across
   * concurrently-running renders sharing this process via a global env var.
   */
  forceParallelStream?: boolean;
  /** For the spawn-failure log message context only. */
  outputFormat: string;
  /** Pre-built encoder options; passed straight to `spawnStreamingEncoder`. */
  streamingEncoderOptions: StreamingEncoderOptions;
  buildCaptureOptions: () => CaptureOptions;
  createRenderVideoFrameInjector: () => BeforeCaptureHook | null;
  abortSignal: AbortSignal | undefined;
  assertNotAborted: () => void;
  onProgress?: ProgressCallback;
  /**
   * Mutated in place — static-dedup perf appended for the sequential session or
   * each parallel worker, aggregated into the `RenderPerfSummary` dedup block.
   * Same append-in-place contract as the disk-capture stage.
   */
  dedupPerfs: CapturePerfSummary[];
}

/** Drain-side safety-net counters for the worker-encode loop (telemetry). */
export interface DeDrainStats {
  verifyChecked: number;
  verifyMinDb?: number;
  blankSuspects: number;
  blankDeterministicAccepts: number;
  blankRecaptures: number;
}

export type CaptureStreamingStageResult =
  | {
      /** Streaming path ran successfully — sequencer should skip the disk path AND Stage 5 encode. */
      success: true;
      /** Wall-clock ms for the encode phase (overlapped with capture; from the encoder's own report). */
      encodeMs: number;
      probeSession: CaptureSession | null;
      lastBrowserConsole: string[];
      workerCount: number;
      /** Engine-resolved screenshot flag from the consumed sequential/probe session, when observed. */
      captureBeyondViewport?: boolean;
      /** Safety-net drain counters (worker-encode loop only; undefined elsewhere). */
      deDrainStats?: DeDrainStats;
    }
  | {
      /** Spawn failed (non-abort) — sequencer should fall back to the disk path. */
      success: false;
    };

const execFileP = promisify(execFile);

/** PSNR (average, dB) between two same-dimension encoded images via ffmpeg. */
async function psnrDb(a: Buffer, b: Buffer): Promise<number> {
  const dir = await mkdtemp(join(tmpdir(), "hf-de-verify-"));
  try {
    const pa = join(dir, "a.jpg");
    const pb = join(dir, "b.jpg");
    await Promise.all([writeFile(pa, a), writeFile(pb, b)]);
    const { stderr } = await execFileP(
      getFfmpegBinary(),
      ["-hide_banner", "-i", pa, "-i", pb, "-lavfi", "psnr", "-f", "null", "-"],
      { maxBuffer: 4 * 1024 * 1024 },
    );
    const m = /average:(inf|[\d.]+)/.exec(stderr);
    if (!m) throw new Error(`psnr parse failed: ${stderr.slice(-300)}`);
    return m[1] === "inf" ? Infinity : Number(m[1]);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

// ── drawElement drain-time safety checks (ungated-release safety net) ──
// Shared by the sequential worker-encode loop and the interleaved parallel
// streaming drain (HF_DE_PARALLEL_STREAM): the guard is session-parameterized
// so each parallel worker's frames verify against ITS OWN session's
// pre-injection ground truth (all sessions arm the same K sample indices from
// CaptureOptions.compositionDurationSeconds, so every sample is checked by
// whichever worker owns that frame).
function createDrainFrameGuard(args: {
  log: CaptureStreamingStageInput["log"];
  stats: DeDrainStats;
  frameTime: (i: number) => number;
}): (session: CaptureSession, idx: number, buf: Buffer) => Promise<Buffer> {
  const { log, stats, frameTime } = args;
  //
  // 1. Blank guard (worker-path analogue of the serial-path guard in
  //    frameCapture): drawElement intermittently returns an anomalously small
  //    blank frame with no throw. A frame far below the rolling-median byte
  //    size is re-captured once (verification-grade recapture — no dedup
  //    shortcut, no screenshot fallback); still blank → verification error.
  //    The floor only arms after 12 drained frames — early frames are covered
  //    by the PSNR verify samples rather than the size heuristic, which has
  //    no stable median yet.
  // 2. Self-verification: at K sampled indices, compare the DE frame against
  //    its pre-injection screenshot ground truth (session.deVerifyFrames).
  //    PSNR below HF_DE_VERIFY_MIN_DB (default 32; natural DE-vs-screenshot
  //    agreement measures ≥45, damage <30) → verification error.
  // A DrawElementVerificationError propagates to the orchestrator, which
  // re-renders the whole job via the screenshot path (never-wrong fallback).
  // Clamp to a defensible band: below ~10dB even severe damage passes (the
  // check stops meaning anything); above ~60dB natural DE-vs-screenshot
  // encoder differences (~45dB+) would force a screenshot fallback on every
  // verified render. Out-of-range or malformed values fall back to 32.
  const verifyMinDbRaw = Number(process.env.HF_DE_VERIFY_MIN_DB ?? "32");
  const verifyMinDb =
    Number.isFinite(verifyMinDbRaw) && verifyMinDbRaw >= 10 && verifyMinDbRaw <= 60
      ? verifyMinDbRaw
      : 32;
  if (process.env.HF_DE_VERIFY_MIN_DB !== undefined && verifyMinDb !== verifyMinDbRaw) {
    log.warn("[Render] HF_DE_VERIFY_MIN_DB out of range [10,60]; using 32", {
      raw: process.env.HF_DE_VERIFY_MIN_DB,
    });
  }
  const sizes: number[] = [];
  // Absolute floor lowers once a small frame proves deterministic (dark /
  // low-detail content), so a dark stretch doesn't re-capture every frame.
  let absFloor = 20_000;
  const blankFloor = (): number => {
    if (sizes.length < 12) return 0;
    const sorted = [...sizes].sort((x, y) => x - y);
    const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
    return Math.max(absFloor, median * 0.12);
  };
  let acceptedSmall: Buffer | null = null;
  return async (session: CaptureSession, idx: number, buf: Buffer): Promise<Buffer> => {
    if (process.env.HF_FORCE_DRAWELEMENT !== "1") {
      const floor = blankFloor();
      if (floor > 0 && buf.length < floor && acceptedSmall?.equals(buf)) {
        stats.blankSuspects += 1;
        stats.blankDeterministicAccepts += 1;
        // Identical to a small frame already proven deterministic (dark
        // clip-gap runs repeat the same bytes) — skip the recapture.
      } else if (floor > 0 && buf.length < floor) {
        stats.blankSuspects += 1;
        stats.blankRecaptures += 1;
        log.warn("[Render] drawElement blank-frame suspect; re-capturing", {
          frame: idx,
          bytes: buf.length,
          floor: Math.round(floor),
        });
        // Verification-grade recapture: NOT captureFrameToBufferPipelined,
        // whose static-dedup fast path and "No cached paint record" screenshot
        // fallback can both return a DIFFERENT frame's pixels at drain time
        // (dedup anchor runs ahead of the drain; the fallback screenshots the
        // injected canvas = last drawn DE frame). Any recapture failure is a
        // verification failure — fall back the whole render.
        let retryBuf: Buffer;
        try {
          retryBuf = await recaptureDrawElementFrameForVerify(session, idx, frameTime(idx));
        } catch (err) {
          throw new DrawElementVerificationError(
            `blank drawElement frame ${idx}: ${buf.length}B < floor ${Math.round(floor)}B and recapture failed (${err instanceof Error ? err.message : String(err)})`,
          );
        }
        if (retryBuf.equals(buf)) {
          // Byte-identical on re-capture ⇒ deterministic content, not a
          // transient blank drop (those are intermittent by nature) — the
          // frame is legitimately small (dark / low-detail). Accept it;
          // deterministic damage classes are the PSNR self-verify's job.
          stats.blankDeterministicAccepts += 1;
          log.info("[Render] drawElement small frame is deterministic; accepted", {
            frame: idx,
            bytes: buf.length,
          });
          absFloor = Math.min(absFloor, Math.floor(buf.length / 2));
          acceptedSmall = buf;
        } else if (retryBuf.length < floor) {
          throw new DrawElementVerificationError(
            `blank drawElement frame ${idx}: ${buf.length}B (retry ${retryBuf.length}B) < floor ${Math.round(floor)}B`,
          );
        } else {
          buf = retryBuf;
        }
      }
      sizes.push(buf.length);
      if (sizes.length > 60) sizes.shift();
    }
    const truth = session.deVerifyFrames?.get(idx);
    if (truth) {
      let db: number;
      try {
        db = await psnrDb(buf, truth);
      } catch (err) {
        // Infrastructure failure (ffmpeg spawn/parse/tmpdir), not evidence of
        // damage — skip this sample rather than failing or falling back.
        log.warn("[Render] drawElement self-verify sample skipped (psnr infrastructure)", {
          frame: idx,
          error: err instanceof Error ? err.message : String(err),
        });
        return buf;
      }
      if (db < verifyMinDb) {
        // Keep the mismatched pair for diagnosis (tmpdir; OS-reaped).
        const dumpDir = await mkdtemp(join(tmpdir(), "hf-de-verify-fail-")).catch(() => null);
        if (dumpDir) {
          await Promise.all([
            writeFile(join(dumpDir, `frame-${idx}-de.jpg`), buf),
            writeFile(join(dumpDir, `frame-${idx}-truth.jpg`), truth),
          ]).catch(() => {});
        }
        throw new DrawElementVerificationError(
          `drawElement self-verify failed at frame ${idx}: ${db.toFixed(1)}dB < ${verifyMinDb}dB vs pre-injection screenshot${dumpDir ? ` (pair: ${dumpDir})` : ""}`,
        );
      }
      stats.verifyChecked += 1;
      stats.verifyMinDb = stats.verifyMinDb === undefined ? db : Math.min(stats.verifyMinDb, db);
      log.info("[Render] drawElement self-verify passed", {
        frame: idx,
        psnrDb: db === Infinity ? "inf" : Number(db.toFixed(1)),
      });
    }
    return buf;
  };
}

async function runWorkerEncodePipelineLoop(
  session: CaptureSession,
  totalFrames: number,
  job: CaptureStreamingStageInput["job"],
  currentEncoder: StreamingEncoder,
  reorderBuffer: ReturnType<typeof createFrameReorderBuffer>,
  assertNotAborted: () => void,
  onProgress: CaptureStreamingStageInput["onProgress"],
  log: CaptureStreamingStageInput["log"],
  stats: DeDrainStats,
): Promise<void> {
  let prev: { idx: number; encodeResult: Promise<Buffer> } | null = null;
  const frameTime = (i: number) => (i * job.config.fps.den) / job.config.fps.num;
  const guard = createDrainFrameGuard({ log, stats, frameTime });
  const guardFrame = (idx: number, buf: Buffer): Promise<Buffer> => guard(session, idx, buf);

  const drainPrev = async (): Promise<void> => {
    if (!prev) return;
    // Observe aborts while parked here (the encode wait + ffmpeg write are the
    // longest stretch of the loop); without this an abort isn't seen until the
    // next produce iteration.
    assertNotAborted();
    const buf = await guardFrame(prev.idx, await prev.encodeResult);
    await reorderBuffer.waitForFrame(prev.idx);
    ensureFrameWritten(await currentEncoder.writeFrame(buf), prev.idx, currentEncoder);
    reorderBuffer.advanceTo(prev.idx + 1);
    job.framesRendered = prev.idx + 1;
    updateJobStatus(
      job,
      "rendering",
      `Streaming frame ${prev.idx + 1}/${totalFrames}`,
      Math.round(25 + ((prev.idx + 1) / totalFrames) * 55),
      onProgress,
    );
  };

  // Batch capture (HF_DE_BATCH=N, N>1, default 4 — validated +1.20x lossless on
  // the 19-comp gate): capture runs of consecutive frames in ONE CDP round-trip
  // each (in-page seek+paint+draw loop), amortizing protocol latency N-fold.
  // Batches break at static-dedup frames (skipped via lastEncodeResult reuse —
  // order-dependent) and at opt-in boundary-screenshot frames; those go through
  // the per-frame path unchanged. onBeforeCapture (video frame injection) needs
  // a node-side hook per frame → no batching. Kill switch: HF_DE_BATCH=0.
  const batchNRaw = Number(process.env.HF_DE_BATCH ?? "4");
  const batchN = Number.isFinite(batchNRaw) ? Math.floor(batchNRaw) : 4;
  const drainBatch = async (batch: Array<{ idx: number; encodeResult: Promise<Buffer> }>) => {
    for (const item of batch) {
      assertNotAborted();
      const buf = await guardFrame(item.idx, await item.encodeResult);
      await reorderBuffer.waitForFrame(item.idx);
      ensureFrameWritten(await currentEncoder.writeFrame(buf), item.idx, currentEncoder);
      reorderBuffer.advanceTo(item.idx + 1);
      job.framesRendered = item.idx + 1;
      updateJobStatus(
        job,
        "rendering",
        `Streaming frame ${item.idx + 1}/${totalFrames}`,
        Math.round(25 + ((item.idx + 1) / totalFrames) * 55),
        onProgress,
      );
    }
  };
  if (batchN > 1 && !session.onBeforeCapture) {
    const boundarySS = process.env.HF_FAST_CAPTURE_BOUNDARY_SS === "true";
    const batchable = (f: number) =>
      !session.staticFrames?.has(f) && !(boundarySS && session.clipBoundaryFrames?.has(f));
    let prevBatch: Array<{ idx: number; encodeResult: Promise<Buffer> }> = [];
    let i = 0;
    while (i < totalFrames) {
      assertNotAborted();
      if (batchable(i)) {
        const idxs: number[] = [];
        while (idxs.length < batchN && i < totalFrames && batchable(i)) {
          idxs.push(i);
          i++;
        }
        // NOTE: draining the previous batch CONCURRENTLY with this capture
        // (kick the evaluate un-awaited, drain, then await) was prototyped and
        // REJECTED 2026-07-03: ~1.0–1.03× on medium/long comps but it perturbed
        // pixels on a deterministic comp (87dB vs ∞ noise floor — main-thread
        // contention shifting a paint-wait to the timeout path). Keep the
        // drain strictly between batch evaluates.
        const results = await captureFramesBatchPipelined(session, idxs, idxs.map(frameTime));
        await drainBatch(prevBatch);
        prevBatch = results.map((r) => ({ idx: r.frameIndex, encodeResult: r.encodeResult }));
      } else {
        const { encodeResult } = await captureFrameToBufferPipelined(session, i, frameTime(i));
        await drainBatch(prevBatch);
        prevBatch = [{ idx: i, encodeResult }];
        i++;
      }
    }
    await drainBatch(prevBatch);
    return;
  }

  // On abort/throw the just-produced frame's encode is still in flight and never
  // awaited (it isn't `prev` yet); cleanupDrawElementWorkerEncode rejects it on
  // close. produceDrawElementFrame attaches a no-op catch to every encodeResult
  // at creation so that orphaned rejection is never an unhandled rejection — so
  // the loop needs no special guard here.
  for (let i = 0; i < totalFrames; i++) {
    assertNotAborted();
    const time = frameTime(i);
    const { encodeResult } = await captureFrameToBufferPipelined(session, i, time);
    await drainPrev();
    prev = { idx: i, encodeResult };
  }
  await drainPrev();
}

export async function runCaptureStreamingStage(
  input: CaptureStreamingStageInput,
): Promise<CaptureStreamingStageResult> {
  const {
    fileServer,
    workDir,
    framesDir,
    videoOnlyPath,
    job,
    totalFrames,
    cfg,
    forceScreenshot,
    log,
    outputFormat,
    streamingEncoderOptions,
    buildCaptureOptions,
    createRenderVideoFrameInjector,
    abortSignal,
    assertNotAborted,
    onProgress,
    dedupPerfs,
    forceParallelStream,
  } = input;
  let { workerCount, probeSession } = input;
  let lastBrowserConsole: string[] = [];
  let deDrainStats: DeDrainStats | undefined;
  let captureBeyondViewport: boolean | undefined = probeSession?.options.captureBeyondViewport;

  // Derive a local cfg view rather than reading `forceScreenshot` from the
  // caller-owned `cfg`. The sequencer threads the resolved value via the
  // explicit parameter; this keeps the engine-facing config a pure
  // pass-through.
  const captureCfg: EngineConfig =
    cfg.forceScreenshot === forceScreenshot ? cfg : { ...cfg, forceScreenshot };

  let streamingEncoder: StreamingEncoder | null = null;
  let streamingEncoderClosed = false;

  try {
    streamingEncoder = await spawnStreamingEncoder(
      videoOnlyPath,
      streamingEncoderOptions,
      abortSignal,
      cfg,
    );
    assertNotAborted();
  } catch (err) {
    if (abortSignal?.aborted) {
      if (streamingEncoder && !streamingEncoderClosed) {
        await (streamingEncoder as StreamingEncoder).close().catch(() => {});
        streamingEncoderClosed = true;
      }
      throw err;
    }
    log.warn("[Render] Streaming encoder spawn failed; falling back to disk-frame encode.", {
      error: err instanceof Error ? err.message : String(err),
      outputFormat,
      workerCount,
      durationSeconds: job.duration,
    });
    return { success: false };
  }

  const currentEncoder: StreamingEncoder = streamingEncoder;

  try {
    // ── Streaming capture + encode (Stage 4 absorbs Stage 5) ──────────
    // Streaming encode is locked in here; capture retries may shrink
    // workerCount later, but must not grow a streaming render past one worker.
    const reorderBuffer = createFrameReorderBuffer(0, totalFrames);

    if (workerCount > 1) {
      // Parallel capture → streaming encode
      // HF_DE_PARALLEL_STREAM (manual opt-in) / forceParallelStream (router):
      // interleaved distribution — worker i takes frames i, i+N, i+2N… so the
      // ordered writer's reorder window is N frames and workers run in
      // lockstep instead of serializing behind contiguous ranges (see
      // distributeFramesInterleaved). Each worker runs the depth-2 pipelined
      // drawElement produce when its session initialized in drawelement mode.
      const deParallelStream =
        forceParallelStream === true || process.env.HF_DE_PARALLEL_STREAM === "true";
      const tasks = deParallelStream
        ? distributeFramesInterleaved(totalFrames, workerCount, workDir)
        : distributeFrames(totalFrames, workerCount, workDir);

      // Drain-time safety net for parallel drawElement frames: the SAME
      // blank-guard + PSNR self-verify the sequential worker-encode drain
      // runs, session-parameterized so each frame verifies against its
      // owning worker's pre-injection ground truth. A verification failure
      // rejects the worker, executeParallelCapture rethrows, and the
      // orchestrator's DrawElementVerificationError handler re-renders via
      // screenshot (post-#2026 it also reverts any worker inversion).
      // Intentionally ONE guard shared by all workers rather than one per
      // worker, so the rolling median it tracks is computed across every
      // worker's interleaved frames together — a better signal than
      // per-worker medians would be. This IS touched from concurrent workers
      // across real await points (recapture, PSNR), so the shared
      // `sizes`/`absFloor`/`acceptedSmall` state can interleave — safe by
      // construction rather than by single-threadedness: `absFloor` only
      // ratchets down (order-independent min), `sizes` is append-only (order
      // doesn't affect the median once ≥12 samples exist), and
      // `acceptedSmall`'s fast path only ever fires on exact byte-equality
      // against a buffer some worker already re-verified deterministic — so
      // whichever worker's buffer lands there, the equality check itself is
      // what re-validates it, not which worker wrote it (review).
      const parallelStats: DeDrainStats = {
        verifyChecked: 0,
        blankSuspects: 0,
        blankDeterministicAccepts: 0,
        blankRecaptures: 0,
      };
      const parallelGuard = createDrainFrameGuard({
        log,
        stats: parallelStats,
        frameTime: (i: number) => (i * job.config.fps.den) / job.config.fps.num,
      });
      let parallelGuardRan = false;
      // First guard/write failure aborts the reorder buffer so peer workers
      // parked in waitForFrame reject instead of deadlocking the pool (the
      // pool awaits ALL workers before surfacing errors). The original error
      // is rethrown below so DrawElementVerificationError keeps its type —
      // executeParallelCapture flattens worker errors to strings.
      let parallelDrainError: Error | null = null;
      const onFrameBuffer = async (
        frameIndex: number,
        buffer: Buffer,
        workerSession: CaptureSession,
      ): Promise<void> => {
        try {
          if (deParallelStream && workerSession.captureMode === "drawelement") {
            parallelGuardRan = true;
            buffer = await parallelGuard(workerSession, frameIndex, buffer);
          }
          await reorderBuffer.waitForFrame(frameIndex);
          ensureFrameWritten(await currentEncoder.writeFrame(buffer), frameIndex, currentEncoder);
          reorderBuffer.advanceTo(frameIndex + 1);
        } catch (err) {
          const e = err instanceof Error ? err : new Error(String(err));
          if (!parallelDrainError) {
            parallelDrainError = e;
            reorderBuffer.abort(e);
          }
          throw e;
        }
      };

      let workerResults;
      try {
        workerResults = await executeParallelCapture(
          fileServer.url,
          workDir,
          tasks,
          buildCaptureOptions(),
          createRenderVideoFrameInjector,
          abortSignal,
          (progress) => {
            job.framesRendered = progress.capturedFrames;
            const frameProgress = progress.capturedFrames / progress.totalFrames;
            const progressPct = 25 + frameProgress * 55;

            if (
              progress.capturedFrames % 30 === 0 ||
              progress.capturedFrames === progress.totalFrames
            ) {
              updateJobStatus(
                job,
                "rendering",
                `Streaming frame ${progress.capturedFrames}/${progress.totalFrames} (${workerCount} workers)`,
                Math.round(progressPct),
                onProgress,
              );
            }
          },
          onFrameBuffer,
          // Interleaved DE workers each need their own browser PROCESS:
          // pages co-tenant in one browser share one compositor, whose
          // internal frame scheduling deprioritizes non-active pages — their
          // canvas `paint` events starve and the drawElement paint-wait slows
          // ~3x (measured: 86s vs 30s on a 3,245-frame rAF comp). This is
          // Chromium's internal frame-production scheduling on ALL platforms,
          // NOT the Linux-only HeadlessExperimental.beginFrame capture mode.
          deParallelStream ? { ...captureCfg, enableBrowserPool: false } : captureCfg,
        );
      } catch (err) {
        // Surface the TYPED drain error (DrawElementVerificationError) so the
        // orchestrator's verify-retry handler recognizes it — the worker pool
        // flattens worker errors into a plain message string.
        if (parallelDrainError) throw parallelDrainError;
        throw err;
      }
      if (parallelDrainError) throw parallelDrainError;
      pushWorkerDedupPerfs(workerResults, dedupPerfs);
      if (parallelGuardRan) {
        deDrainStats = parallelStats;
      }

      if (probeSession) {
        captureBeyondViewport = probeSession.options.captureBeyondViewport;
        lastBrowserConsole = probeSession.browserConsoleBuffer;
        await closeCaptureSession(probeSession);
        probeSession = null;
      }
    } else {
      // Sequential capture → streaming encode

      const videoInjector = createRenderVideoFrameInjector();
      const session =
        probeSession ??
        (await createCaptureSession(
          fileServer.url,
          framesDir,
          buildCaptureOptions(),
          videoInjector,
          captureCfg,
        ));
      captureBeyondViewport = session.options.captureBeyondViewport;
      if (probeSession) {
        prepareCaptureSessionForReuse(session, framesDir, videoInjector);
        probeSession = null;
      }

      try {
        if (!session.isInitialized) {
          await initializeSession(session);
        }
        // Probe-initialized video comps defer verification + canvas injection
        // until the injector exists (attached by prepareCaptureSessionForReuse
        // above) — complete it now so drawElement runs VERIFIED on video comps.
        await completeDeferredDrawElementInit(session);
        assertNotAborted();
        lastBrowserConsole = session.browserConsoleBuffer;

        if (session.workerEncodeEnabled) {
          // Worker-encode pipeline: depth-2. Frame N's in-page Worker encodes
          // while frame N+1's main thread does seek+paint+drawElement+kick.
          deDrainStats = {
            verifyChecked: 0,
            blankSuspects: 0,
            blankDeterministicAccepts: 0,
            blankRecaptures: 0,
          };
          await runWorkerEncodePipelineLoop(
            session,
            totalFrames,
            job,
            currentEncoder,
            reorderBuffer,
            assertNotAborted,
            onProgress,
            log,
            deDrainStats,
          );
        } else {
          for (let i = 0; i < totalFrames; i++) {
            assertNotAborted();
            const time = (i * job.config.fps.den) / job.config.fps.num;
            const { buffer } = await captureFrameToBuffer(session, i, time);
            await reorderBuffer.waitForFrame(i);
            ensureFrameWritten(await currentEncoder.writeFrame(buffer), i, currentEncoder);
            reorderBuffer.advanceTo(i + 1);
            job.framesRendered = i + 1;

            const frameProgress = (i + 1) / totalFrames;
            const progress = 25 + frameProgress * 55;

            // Keep status cadence identical to disk sequential capture; the
            // capture error wrapper below must remain separate from finally so it
            // can throw with the browser console before encoder cleanup runs.
            // fallow-ignore-next-line code-duplication
            updateJobStatus(
              job,
              "rendering",
              `Streaming frame ${i + 1}/${totalFrames}`,
              Math.round(progress),
              onProgress,
            );
          }
        }
        // Capture the session's static-dedup perf before close (counters valid
        // only while the session is live).
        dedupPerfs.push(getCapturePerfSummary(session));
        // This must mirror disk capture: catch wraps the original failure with
        // browser diagnostics, finally only handles cleanup.
        // fallow-ignore-next-line code-duplication
      } catch (error) {
        lastBrowserConsole = session.browserConsoleBuffer;
        throw wrapCaptureStageError(error, lastBrowserConsole);
      } finally {
        // Keep the latest console buffer for success and cleanup-error summaries.
        lastBrowserConsole = session.browserConsoleBuffer;
        await closeCaptureSession(session);
      }
    }

    // Close encoder and get result
    const encodeResult = await currentEncoder.close();
    streamingEncoderClosed = true;
    assertNotAborted();

    if (!encodeResult.success) {
      throw new Error(`Streaming encode failed: ${encodeResult.error}`);
    }

    return {
      success: true,
      encodeMs: encodeResult.durationMs,
      probeSession,
      lastBrowserConsole,
      workerCount,
      deDrainStats,
      captureBeyondViewport,
    };
  } finally {
    // Defensive cleanup: if the streaming branch threw before
    // currentEncoder.close() (e.g. capture failure, abort, broken pipe),
    // the ffmpeg subprocess would otherwise leak. close() is idempotent so
    // this is safe to call alongside the success-path close — we just gate
    // on the flag to avoid redundant work.
    if (streamingEncoder && !streamingEncoderClosed) {
      try {
        await streamingEncoder.close();
      } catch (err) {
        log.warn("streamingEncoder defensive close failed", {
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }
}
