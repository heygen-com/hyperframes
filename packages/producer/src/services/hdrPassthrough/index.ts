/**
 * HDR video passthrough with cached overlays — orchestration and fallback.
 *
 * `attemptHdrPassthrough` is the only entry point the render orchestrator
 * calls, and only when `cfg.experimentalHdrPassthrough` is on and the render
 * has HDR content on the layered route. It returns `fallback` (already
 * logged) whenever the composition is ineligible or any stage throws, and the
 * caller then runs the existing layered stage unchanged. Aborts are never
 * turned into a fallback: they propagate.
 */

import { join } from "node:path";
import {
  type CaptureSession,
  closeCaptureSession,
  createCaptureSession,
  initTransparentBackground,
  initializeSession,
} from "@hyperframes/engine";
import { noteStaticDedupActivity, reportFrameProgress } from "../render/shared.js";
import { checkPassthroughEligibility } from "./eligibility.js";
import { planOverlayStates } from "./planner.js";
import { OverlayStateMismatchError, captureOverlayStates } from "./overlayCapture.js";
import { compositeAndEncode } from "./ffmpegComposite.js";
import type {
  EligiblePassthrough,
  HdrPassthroughInput,
  HdrPassthroughOutcome,
  HdrPassthroughResult,
  LazyOverlaySession,
} from "./types.js";

/** Overlay PNGs live under the render's frames dir so workDir cleanup owns them. */
const OVERLAY_DIR_NAME = "hdr-passthrough-overlays";

/** Progress band (percent of the whole render) the passthrough reports in; matches the layered loop's 25–80. */
const CAPTURE_PROGRESS_START = 25;
const ENCODE_PROGRESS_START = 35;
const PROGRESS_END = 80;

/**
 * A DOM capture session configured like the layered stage's `domSession`
 * (screenshot mode, transparent background, the render's video-frame
 * injector), opened on first `get()`.
 */
export function createLazyOverlaySession(input: HdrPassthroughInput): LazyOverlaySession {
  let opening: Promise<CaptureSession> | undefined;
  let session: CaptureSession | undefined;
  return {
    get opened() {
      return opening !== undefined;
    },
    get() {
      opening ??= (async () => {
        if (!input.fileServer) {
          throw new Error("fileServer must be initialized before HDR passthrough");
        }
        // captureAlphaPng hangs under begin-frame control; same constraint as the layered stage.
        session = await createCaptureSession(
          input.fileServer.url,
          input.framesDir,
          input.buildCaptureOptions(),
          input.createRenderVideoFrameInjector(),
          { ...input.cfg, forceScreenshot: true },
        );
        await initializeSession(session);
        input.assertNotAborted();
        await initTransparentBackground(session.page, { clearCompositionRoot: true });
        return session;
      })();
      return opening;
    },
    async close() {
      const opened = session;
      session = undefined;
      if (!opened) return;
      try {
        await closeCaptureSession(opened);
      } catch (error) {
        input.log.warn("[Render] HDR passthrough: closing the overlay session failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  };
}

/**
 * Runs planner → overlay capture → ffmpeg composite for an eligible
 * composition and writes `input.videoOnlyPath`. Throws on any failure; the
 * caller (`attemptHdrPassthrough`) turns that into a fallback.
 *
 * Progress: overlay capture reports in 25–35% and ticks the stall watcher's
 * activity counter per state; the encode reports 35–80% and drives
 * `job.framesRendered` from ffmpeg's encoded-frame count, so the stage's
 * frame stall rule sees real progress and `complete()` only once every frame
 * is encoded.
 */
async function runHdrPassthrough(
  input: HdrPassthroughInput,
  eligible: EligiblePassthrough,
  session: LazyOverlaySession,
): Promise<HdrPassthroughResult> {
  const { job, log, width, height, totalFrames, onProgress } = input;
  const stageStart = Date.now();
  const transfer = input.preset.hdr?.transfer ?? eligible.video.transfer;

  const plan = planOverlayStates({
    timing: eligible.timing,
    fps: job.config.fps,
    width,
    height,
  });
  log.info("[Render] HDR passthrough: compositing cached overlays onto the source video", {
    videoId: eligible.video.id,
    candidates: plan.states.length,
    totalFrames,
    transfer,
  });

  const page = await session.get();
  input.assertNotAborted();
  const overlays = await captureOverlayStates({
    input,
    session: page,
    plan,
    video: eligible.video,
    outDir: join(input.framesDir, OVERLAY_DIR_NAME),
    onStateCaptured: (_framesCovered, statesDone, statesTotal) => {
      noteStaticDedupActivity(job);
      reportFrameProgress(
        job,
        `HDR passthrough overlay ${statesDone}/${statesTotal}`,
        CAPTURE_PROGRESS_START +
          (statesDone / Math.max(1, statesTotal)) *
            (ENCODE_PROGRESS_START - CAPTURE_PROGRESS_START),
        onProgress,
        statesDone,
        statesTotal,
      );
    },
  });
  log.info("[Render] HDR passthrough: overlay states captured", {
    states: overlays.overlays.length,
    candidates: overlays.candidateCount,
    captures: overlays.captureCount,
    verifyProbes: overlays.verifyProbeCount,
    unique: overlays.uniqueCount,
    captureMs: overlays.captureMs,
  });
  await session.close();
  input.assertNotAborted();

  const composite = await compositeAndEncode({
    video: eligible.video,
    plan: overlays.plan,
    overlays,
    encoder: {
      preset: input.preset,
      effectiveQuality: input.effectiveQuality,
      effectiveBitrate: input.effectiveBitrate,
      deliveryEncoder: input.deliveryEncoder,
      useGpu: job.config.useGpu,
    },
    hdr: { transfer },
    outputPath: input.videoOnlyPath,
    workDir: input.framesDir,
    abortSignal: input.abortSignal,
    onFramesEncoded: (frames) => {
      const done = Math.min(frames, totalFrames);
      job.framesRendered = done;
      reportFrameProgress(
        job,
        `HDR passthrough encode frame ${done}/${totalFrames}`,
        ENCODE_PROGRESS_START +
          (done / Math.max(1, totalFrames)) * (PROGRESS_END - ENCODE_PROGRESS_START),
        onProgress,
        done,
        totalFrames,
      );
    },
  });
  job.framesRendered = totalFrames;

  return {
    lastBrowserConsole: page.browserConsoleBuffer,
    hdrPerf: undefined,
    captureDurationMs: Date.now() - stageStart,
    encodeMs: composite.encodeMs,
    warnings: [],
  };
}

function isAbort(input: HdrPassthroughInput, error: unknown): boolean {
  if (input.abortSignal?.aborted) return true;
  return error instanceof Error && error.name === "AbortError";
}

/**
 * Eligibility → passthrough, with fallback. Always closes the overlay
 * session before returning. Rethrows when the render was aborted; every
 * other failure becomes `{ kind: "fallback" }` with a warning, and the caller
 * must reset capture progress and run the layered stage.
 */
export async function attemptHdrPassthrough(
  input: HdrPassthroughInput,
): Promise<HdrPassthroughOutcome> {
  const { log } = input;
  const session = createLazyOverlaySession(input);
  try {
    const eligibility = await checkPassthroughEligibility({ input, session });
    // The analysis can run for a while on a long composition before the first
    // overlay state ticks the stall watcher.
    noteStaticDedupActivity(input.job);
    if (!eligibility.eligible) {
      log.info(
        `[Render] HDR passthrough off: ${eligibility.reason}` +
          (eligibility.detail ? ` (${eligibility.detail})` : ""),
      );
      return { kind: "fallback", reason: eligibility.reason, detail: eligibility.detail };
    }
    const result = await runHdrPassthrough(input, eligibility, session);
    return { kind: "completed", result };
  } catch (error) {
    if (isAbort(input, error)) throw error;
    if (error instanceof OverlayStateMismatchError) {
      log.info(`[Render] HDR passthrough off: overlay_unverified (${error.message})`);
      return { kind: "fallback", reason: "overlay_unverified", detail: error.message };
    }
    const detail = error instanceof Error ? error.message : String(error);
    log.warn("[Render] HDR passthrough failed; falling back to the layered HDR composite", {
      error: detail,
    });
    return { kind: "fallback", reason: "error", detail };
  } finally {
    await session.close();
  }
}
