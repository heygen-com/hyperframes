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
import { checkPassthroughEligibility, findSeekCallbacks } from "./eligibility.js";
import { planOverlayStates } from "./planner.js";
import {
  OverlayStateMismatchError,
  VideoLayerChangedError,
  captureOverlayStates,
} from "./overlayCapture.js";
import { findFingerprintBlindSpots } from "./overlayFingerprint.js";
import { armPageCodeWatch, attachPageCodeWatch, pageCodeWatchOf } from "./pageCodeWatch.js";
import { POSITION_SEEK_REAPPLY_SCRIPT } from "../htmlCompiler.js";
import { compositeAndEncode } from "./ffmpegComposite.js";
import type {
  EligiblePassthrough,
  HdrPassthroughInput,
  HdrPassthroughOutcome,
  HdrPassthroughResult,
  LazyOverlaySession,
  PassthroughIneligibleReason,
} from "./types.js";

/** Overlay PNGs live under the render's frames dir so workDir cleanup owns them. */
const OVERLAY_DIR_NAME = "hdr-passthrough-overlays";

/** Progress band (percent of the whole render) the passthrough reports in; matches the layered loop's 25–80. */
const CAPTURE_PROGRESS_START = 25;
const ENCODE_PROGRESS_START = 35;
const PROGRESS_END = 80;

/** How the overlay session opens and closes a capture session; injectable for tests. */
export interface OverlaySessionDeps {
  /** Opens a ready session, or throws having closed whatever it opened. */
  open: (input: HdrPassthroughInput) => Promise<CaptureSession>;
  close: (session: CaptureSession) => Promise<void>;
}

/**
 * A DOM capture session configured like the layered stage's `domSession`
 * (screenshot mode, transparent background, the render's video-frame
 * injector), with the page code watch armed before it navigates and counting
 * once it is ready (`pageCodeWatch.ts`). A session that fails to initialise
 * is closed before the error propagates.
 */
async function openOverlaySession(input: HdrPassthroughInput): Promise<CaptureSession> {
  if (!input.fileServer) {
    throw new Error("fileServer must be initialized before HDR passthrough");
  }
  // captureAlphaPng hangs under begin-frame control; same constraint as the layered stage.
  const session = await createCaptureSession(
    input.fileServer.url,
    input.framesDir,
    input.buildCaptureOptions(),
    input.createRenderVideoFrameInjector(),
    { ...input.cfg, forceScreenshot: true },
  );
  try {
    const watch = await armPageCodeWatch(session.page, [
      ...input.fileServer.injectedScriptTexts(),
      POSITION_SEEK_REAPPLY_SCRIPT,
    ]);
    attachPageCodeWatch(session.page, watch);
    await initializeSession(session);
    input.assertNotAborted();
    await initTransparentBackground(session.page, { clearCompositionRoot: true });
    await watch.start();
    return session;
  } catch (error) {
    await closeOverlaySession(session).catch(() => undefined);
    throw error;
  }
}

async function closeOverlaySession(session: CaptureSession): Promise<void> {
  await pageCodeWatchOf(session.page)?.dispose();
  await closeCaptureSession(session);
}

const DEFAULT_SESSION_DEPS: OverlaySessionDeps = {
  open: openOverlaySession,
  close: closeOverlaySession,
};

/**
 * The overlay session, opened on first `get()`. `close()` waits for an open
 * still in flight and closes what it opened, so a close that races the open
 * never leaves a browser page behind; `get()` after `close()` rejects.
 */
export function createLazyOverlaySession(
  input: HdrPassthroughInput,
  deps: OverlaySessionDeps = DEFAULT_SESSION_DEPS,
): LazyOverlaySession {
  let opening: Promise<CaptureSession> | undefined;
  let closed = false;
  return {
    get opened() {
      return opening !== undefined;
    },
    get() {
      if (closed) {
        return Promise.reject(new Error("hdrPassthrough: the overlay session is closed"));
      }
      opening ??= deps.open(input);
      return opening;
    },
    async close() {
      if (closed) return;
      closed = true;
      if (!opening) return;
      let session: CaptureSession;
      try {
        session = await opening;
      } catch {
        return; // a failed open closed what it had opened
      }
      try {
        await deps.close(session);
      } catch (error) {
        input.log.warn("[Render] HDR passthrough: closing the overlay session failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  };
}

/**
 * A decline found after eligibility (overlay capture's own checks): the
 * passthrough falls back with `reason`, logged like an ineligible composition.
 */
class PassthroughDeclinedError extends Error {
  constructor(
    readonly reason: PassthroughIneligibleReason,
    readonly detail: string,
  ) {
    super(`${reason}: ${detail}`);
    this.name = "PassthroughDeclinedError";
  }
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
  // Fingerprints stand in for pixels only while no page code runs after load (pageCodeWatch.ts).
  const pageCode = pageCodeWatchOf(page.page);
  if (!pageCode) throw new PassthroughDeclinedError("seek_callback", "no page code watch");
  const overlays = await captureOverlayStates({
    input,
    session: page,
    plan,
    video: eligible.video,
    outDir: join(input.framesDir, OVERLAY_DIR_NAME),
    onVerifyProbe: () => noteStaticDedupActivity(job),
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
  }).catch(async (error: unknown) => {
    await pageCode.dispose();
    throw error;
  });
  log.info("[Render] HDR passthrough: overlay states captured", {
    states: overlays.overlays.length,
    candidates: overlays.candidateCount,
    captures: overlays.captureCount,
    verifyProbes: overlays.verifyProbeCount,
    unique: overlays.uniqueCount,
    captureMs: overlays.captureMs,
  });
  const pageCodeRan = await pageCode.stop();
  if (pageCodeRan) throw new PassthroughDeclinedError("seek_callback", pageCodeRan);
  // A callback first registered, or unreadable content first attached, on a frame only capture visited.
  const lateCallbacks = await findSeekCallbacks(page.page);
  if (lateCallbacks) throw new PassthroughDeclinedError("seek_callback", lateCallbacks);
  const lateBlindSpot = await findFingerprintBlindSpots(page.page);
  if (lateBlindSpot) throw new PassthroughDeclinedError("overlay_unreadable", lateBlindSpot);
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
    if (error instanceof PassthroughDeclinedError) {
      log.info(`[Render] HDR passthrough off: ${error.reason} (${error.detail})`);
      return { kind: "fallback", reason: error.reason, detail: error.detail };
    }
    if (error instanceof VideoLayerChangedError) {
      log.info(`[Render] HDR passthrough off: video_animated (${error.message})`);
      return { kind: "fallback", reason: "video_animated", detail: error.message };
    }
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
