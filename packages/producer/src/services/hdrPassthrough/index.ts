/**
 * HDR video passthrough with cached overlays — orchestration and fallback.
 *
 * `attemptHdrPassthrough` is the only entry point the render orchestrator
 * calls, and only when `cfg.experimentalHdrPassthrough` is on and the render
 * has HDR content on the layered route. It returns `fallback` (already
 * logged) whenever the composition is ineligible or any stage throws, and the
 * caller then runs the existing layered stage unchanged. Aborts are never
 * turned into a fallback: they propagate.
 *
 * Eligibility runs on an analysis page and capture on a second, fresh one
 * (`overlayPages.ts`): the capture page takes the layered DOM session's
 * steps before frame 0 and then visits the frames in order, so browser state
 * that seeks leave behind is the layered render's at every frame.
 */

import { join } from "node:path";
import {
  type CaptureOptions,
  type CaptureSession,
  closeCaptureSession,
  createCaptureSession,
  initTransparentBackground,
  initializeSession,
} from "@hyperframes/engine";
import { noteStaticDedupActivity, reportFrameProgress } from "../render/shared.js";
import { planHdrResources, probeHdrExtractionDims } from "../render/stages/captureHdrResources.js";
import { readLayeredScenes } from "../render/stages/captureHdrStage.js";
import { checkPassthroughEligibility } from "./eligibility.js";
import { findOwnClockDrivers, planOverlayStates } from "./planner.js";
import {
  OverlayStateMismatchError,
  VideoLayerChangedError,
  captureOverlayStates,
} from "./overlayCapture.js";
import { releaseIsolated } from "./isolatedWorld.js";
import { inspectPageContent, inspectPageState, pageGateTimings } from "./overlayPageGates.js";
import {
  armPageCodeWatch,
  attachPageCodeWatch,
  type PageCodeWatch,
  pageCodeWatchOf,
} from "./pageCodeWatch.js";
import { POSITION_SEEK_REAPPLY_SCRIPT } from "../htmlCompiler.js";
import { compositeAndEncode } from "./ffmpegComposite.js";
import { mirrorReferenceBackground, overlayPageOptions } from "./overlayPages.js";
import type {
  CheckPassthroughEligibilityArgs,
  EligiblePassthrough,
  HdrPassthroughInput,
  HdrPassthroughOutcome,
  HdrPassthroughResult,
  LazyOverlaySession,
  PassthroughEligibility,
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
  /**
   * Opens a ready session, or throws having closed whatever it opened.
   * `recordReferenceBackground` replaces the render's recorder in the page's
   * options (`overlayPageOptions`).
   */
  open: (
    input: HdrPassthroughInput,
    recordReferenceBackground: CaptureOptions["recordReferenceBackground"],
  ) => Promise<CaptureSession>;
  close: (session: CaptureSession) => Promise<void>;
}

/**
 * A DOM capture session configured like the layered stage's `domSession`
 * (screenshot mode, transparent background, the render's video-frame
 * injector, its capture options with the shared memos copied and
 * `recordReferenceBackground` replaced: `overlayPages.ts`), with the page
 * code watch armed before it navigates and counting once it is ready
 * (`pageCodeWatch.ts`). A session that fails to initialise is closed before
 * the error propagates.
 */
async function openOverlaySession(
  input: HdrPassthroughInput,
  recordReferenceBackground: CaptureOptions["recordReferenceBackground"],
): Promise<CaptureSession> {
  const fileServer = input.fileServer;
  if (!fileServer) {
    throw new Error("fileServer must be initialized before HDR passthrough");
  }
  // Armed as the page opens, before the engine registers or evaluates anything on it, so every
  // script the renderer sends is known by its text (`scriptOrigins.ts`).
  let watch: PageCodeWatch | undefined;
  const onPageOpened = async (page: CaptureSession["page"]) => {
    watch = await armPageCodeWatch(page, [
      ...fileServer.injectedScriptTexts(),
      POSITION_SEEK_REAPPLY_SCRIPT,
    ]);
    attachPageCodeWatch(page, watch);
  };
  // captureAlphaPng hangs under begin-frame control; same constraint as the layered stage.
  const session = await createCaptureSession(
    fileServer.url,
    input.framesDir,
    { ...overlayPageOptions(input.buildCaptureOptions(), recordReferenceBackground), onPageOpened },
    input.createRenderVideoFrameInjector(),
    { ...input.cfg, forceScreenshot: true },
  );
  try {
    if (!watch) throw new Error("hdrPassthrough: the page code watch was not armed");
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
  await releaseIsolated(session.page);
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
 * `recordReferenceBackground` goes to `deps.open`: `undefined` for the
 * analysis page.
 */
export function createLazyOverlaySession(
  input: HdrPassthroughInput,
  deps: OverlaySessionDeps = DEFAULT_SESSION_DEPS,
  recordReferenceBackground?: CaptureOptions["recordReferenceBackground"],
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
      opening ??= deps.open(input, recordReferenceBackground);
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
 * The layered DOM session's steps between its load and frame 0
 * (`runCaptureHdrStage`), on the capture page: the scene reads, then the
 * seek, frame injection and stacking query at each native HDR start time
 * (`probeHdrExtractionDims`). Its options load the page as the layered
 * session's would (`overlayPages.ts`).
 */
async function replayLayeredPrelude(
  input: HdrPassthroughInput,
  session: CaptureSession,
): Promise<void> {
  await readLayeredScenes(session);
  const prep = planHdrResources({
    composition: input.composition,
    nativeHdrVideoIds: input.nativeHdrVideoIds,
    nativeHdrImageIds: input.nativeHdrImageIds,
    projectDir: input.projectDir,
    compiledDir: input.compiledDir,
  });
  await probeHdrExtractionDims({
    domSession: session,
    nativeHdrIds: new Set([...input.nativeHdrVideoIds, ...input.nativeHdrImageIds]),
    nativeHdrImageIds: input.nativeHdrImageIds,
    composition: input.composition,
    prep,
  });
}

/**
 * Runs planner → overlay capture → ffmpeg composite for an eligible
 * composition and writes `input.videoOnlyPath`. Throws on any failure; the
 * caller (`attemptHdrPassthrough`) turns that into a fallback.
 *
 * `session` is the capture page, never the one eligibility seeked. Before
 * its first seek, the DevTools-only gates read what it registered while it
 * loaded (`inspectPageState`); then it replays the layered session's steps
 * before frame 0 (`replayLayeredPrelude`) and capture walks the frames in
 * order.
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
  // This page loaded on its own: what it registered meanwhile, before any seek or in-page probe.
  const loaded = await inspectPageState(page.page);
  if (loaded) throw new PassthroughDeclinedError(loaded.reason, loaded.detail);
  await replayLayeredPrelude(input, page);
  input.assertNotAborted();
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
  // A callback first registered, or content first attached, on a frame only capture visited; read
  // before the watch stops, so a probe here that reached page code is counted too.
  const lateState = await inspectPageState(page.page);
  if (lateState) throw new PassthroughDeclinedError(lateState.reason, lateState.detail);
  const lateContent = await inspectPageContent(page.page, eligible.video.id, true);
  if (lateContent) throw new PassthroughDeclinedError(lateContent.reason, lateContent.detail);
  const lateDrivers = await findOwnClockDrivers(page.page);
  if (lateDrivers) throw new PassthroughDeclinedError("overlay_non_gsap_animation", lateDrivers);
  log.info("[Render] HDR passthrough: page gates", {
    ...pageGateTimings(page.page),
    ...pageCode.registrations.stats(),
  });
  const pageCodeRan = await pageCode.stop();
  if (pageCodeRan) throw new PassthroughDeclinedError("seek_callback", pageCodeRan);
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

/** The steps of `attemptHdrPassthrough`, injectable for tests. */
export interface PassthroughDeps {
  sessions: OverlaySessionDeps;
  checkEligibility: (args: CheckPassthroughEligibilityArgs) => Promise<PassthroughEligibility>;
  /** What page code ran on the analysis page since it loaded, or why that cannot be said. */
  analysisPageCode: (session: CaptureSession) => Promise<string | null>;
  run: (
    input: HdrPassthroughInput,
    eligible: EligiblePassthrough,
    session: LazyOverlaySession,
  ) => Promise<HdrPassthroughResult>;
}

const DEFAULT_PASSTHROUGH_DEPS: PassthroughDeps = {
  sessions: DEFAULT_SESSION_DEPS,
  checkEligibility: (args) => checkPassthroughEligibility(args),
  analysisPageCode: async (session) => {
    const watch = pageCodeWatchOf(session.page);
    return watch ? watch.stop() : "no page code watch";
  },
  run: runHdrPassthrough,
};

/**
 * Eligibility → passthrough, with fallback. Eligibility runs on the analysis
 * page; any page function that ran there since load (eligibility's probes,
 * samples and analysis included) declines with `seek_callback`. The analysis
 * page is closed before the capture page opens, and both are closed before
 * returning. The capture page reads the reference background only when the
 * layered session would have, and the render records it only once the
 * passthrough completes (`overlayPages.ts`). Rethrows when the render was
 * aborted; every other failure becomes `{ kind: "fallback" }` with a
 * warning, and the caller must reset capture progress and run the layered
 * stage.
 */
export async function attemptHdrPassthrough(
  input: HdrPassthroughInput,
  deps: PassthroughDeps = DEFAULT_PASSTHROUGH_DEPS,
): Promise<HdrPassthroughOutcome> {
  const { log } = input;
  const analysis = createLazyOverlaySession(input, deps.sessions);
  let capture: LazyOverlaySession | undefined;
  try {
    const eligibility = await deps.checkEligibility({ input, session: analysis });
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
    const analysisRan = await deps.analysisPageCode(await analysis.get());
    if (analysisRan) throw new PassthroughDeclinedError("seek_callback", analysisRan);
    await analysis.close();
    input.assertNotAborted();
    const referenceBackground = mirrorReferenceBackground(
      input.buildCaptureOptions().recordReferenceBackground,
    );
    capture = createLazyOverlaySession(input, deps.sessions, referenceBackground.recordOnPage);
    const result = await deps.run(input, eligibility, capture);
    await referenceBackground.commit();
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
    await analysis.close();
    await capture?.close();
  }
}
