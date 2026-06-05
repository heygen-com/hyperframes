/**
 * Capture-cost calibration and worker-count resolution.
 *
 * The "calibration" flow renders a handful of representative frames in
 * a throwaway `CaptureSession` and uses p95 capture time to scale the
 * auto-worker budget. The calibration ceiling
 * (`MAX_MEASURED_CAPTURE_COST_MULTIPLIER`) and target
 * (`CAPTURE_CALIBRATION_TARGET_MS`) are tunable knobs — they pin the
 * relationship between observed capture time and worker count.
 */

import { join } from "node:path";
import { fpsToNumber } from "@hyperframes/core";
import {
  type BeforeCaptureHook,
  type CaptureOptions,
  type CaptureSession,
  type EngineConfig,
  calculateOptimalWorkers,
  captureFrameToBuffer,
  closeCaptureSession,
  createCaptureSession,
  initializeSession,
} from "@hyperframes/engine";
import type { CompiledComposition } from "../htmlCompiler.js";
import type { FileServerHandle } from "../fileServer.js";
import { defaultLogger, type ProducerLogger } from "../../logger.js";
import type { RenderJob } from "../renderOrchestrator.js";
import { normalizeErrorMessage } from "../../utils/errorMessage.js";

export interface CaptureCostEstimate {
  multiplier: number;
  reasons: string[];
  p95Ms?: number;
}

export interface CaptureCalibrationSample {
  frameIndex: number;
  captureTimeMs: number;
}

/**
 * Target p95 capture time used to scale the auto-worker budget. If the
 * measured p95 exceeds this, the multiplier ratchets up. Empirically
 * tuned against the producer's regression-harness fixtures.
 */
export const CAPTURE_CALIBRATION_TARGET_MS = 600;

/**
 * Ceiling on the measured cost multiplier. Without this, a pathological
 * 30-second capture would push the auto-worker budget arbitrarily high.
 */
export const MAX_MEASURED_CAPTURE_COST_MULTIPLIER = 8;

/**
 * CDP protocol timeout used while running calibration. Bounded below
 * the normal `cfg.protocolTimeout` so a wedged BeginFrame calibration
 * times out fast and falls back to screenshot mode (see the
 * `shouldFallbackToScreenshotAfterCalibrationError` path in the
 * sequencer).
 */
export const CAPTURE_CALIBRATION_PROTOCOL_TIMEOUT_MS = 30_000;

export function estimateCaptureCostMultiplier(
  compiled: Pick<CompiledComposition, "hasShaderTransitions" | "renderModeHints">,
): CaptureCostEstimate {
  let multiplier = 1;
  const reasons: string[] = [];

  if (compiled.hasShaderTransitions) {
    multiplier += 2;
    reasons.push("shader-transitions");
  }

  const reasonCodes = new Set(compiled.renderModeHints.reasons.map((reason) => reason.code));
  if (reasonCodes.has("requestAnimationFrame")) {
    multiplier += 1;
    reasons.push("requestAnimationFrame");
  }
  if (reasonCodes.has("iframe")) {
    multiplier += 0.5;
    reasons.push("iframe");
  }

  return {
    multiplier: Math.round(multiplier * 100) / 100,
    reasons,
  };
}

function combineCaptureCostEstimates(
  staticCost: CaptureCostEstimate,
  measuredCost?: CaptureCostEstimate,
): CaptureCostEstimate {
  if (!measuredCost || measuredCost.multiplier <= 1) return staticCost;
  if (staticCost.multiplier >= measuredCost.multiplier) {
    return {
      multiplier: staticCost.multiplier,
      reasons: [...staticCost.reasons, ...measuredCost.reasons],
      p95Ms: measuredCost.p95Ms,
    };
  }
  return {
    multiplier: measuredCost.multiplier,
    reasons: [...measuredCost.reasons, ...staticCost.reasons],
    p95Ms: measuredCost.p95Ms,
  };
}

export function resolveRenderWorkerCount(
  totalFrames: number,
  requestedWorkers: number | undefined,
  cfg: EngineConfig,
  compiled: Pick<CompiledComposition, "hasShaderTransitions" | "renderModeHints">,
  log: ProducerLogger = defaultLogger,
  measuredCaptureCost?: CaptureCostEstimate,
): number {
  // TODO(htmlInCanvas): workaround — Chrome's experimental drawElementImage
  // API (CanvasDrawElement) is non-deterministic across concurrent browser
  // instances due to paint-cache races and SwiftShader contention.
  // Remove this clamp once Chromium stabilizes CanvasDrawElement for
  // concurrent use.
  const reasonCodes = new Set(compiled.renderModeHints.reasons.map((r) => r.code));
  if (reasonCodes.has("htmlInCanvas")) {
    log.warn(
      "[Render] html-in-canvas (drawElementImage) detected — pinning to 1 worker (Chrome concurrency limitation).",
      { requestedWorkers },
    );
    return 1;
  }

  const captureCost = combineCaptureCostEstimates(
    estimateCaptureCostMultiplier(compiled),
    measuredCaptureCost,
  );
  const workerCount = calculateOptimalWorkers(totalFrames, requestedWorkers, {
    ...cfg,
    captureCostMultiplier: captureCost.multiplier,
  });

  if (requestedWorkers !== undefined || captureCost.multiplier <= 1) {
    return workerCount;
  }

  const baselineWorkers = calculateOptimalWorkers(totalFrames, undefined, cfg);
  if (workerCount < baselineWorkers) {
    log.warn(
      "[Render] Reduced auto worker count for high-cost capture workload to avoid Chrome compositor starvation.",
      {
        from: baselineWorkers,
        to: workerCount,
        costMultiplier: captureCost.multiplier,
        reasons: captureCost.reasons,
      },
    );
  }

  return workerCount;
}

export function createCaptureCalibrationConfig(cfg: EngineConfig): EngineConfig {
  return {
    ...cfg,
    protocolTimeout: Math.max(cfg.protocolTimeout, CAPTURE_CALIBRATION_PROTOCOL_TIMEOUT_MS),
  };
}

export function estimateMeasuredCaptureCostMultiplier(
  samples: CaptureCalibrationSample[],
): CaptureCostEstimate {
  if (samples.length === 0) {
    return { multiplier: 1, reasons: [] };
  }

  const sorted = [...samples].sort((a, b) => a.captureTimeMs - b.captureTimeMs);
  const p95Index = Math.max(0, Math.ceil(sorted.length * 0.95) - 1);
  const p95Sample = sorted[p95Index] ?? sorted[sorted.length - 1];
  if (!p95Sample) {
    return { multiplier: 1, reasons: [] };
  }
  const p95Ms = Math.round(p95Sample.captureTimeMs);
  const multiplier = Math.min(
    MAX_MEASURED_CAPTURE_COST_MULTIPLIER,
    Math.max(1, Math.round((p95Ms / CAPTURE_CALIBRATION_TARGET_MS) * 100) / 100),
  );

  return {
    multiplier,
    reasons: multiplier > 1 ? [`calibration-p95=${p95Ms}ms`] : [],
    p95Ms,
  };
}

export function selectCaptureCalibrationFrames(totalFrames: number): number[] {
  if (totalFrames <= 0) return [];
  const lastFrame = totalFrames - 1;
  const candidates = [
    0,
    Math.floor(totalFrames * 0.25),
    Math.floor(totalFrames * 0.5),
    Math.floor(totalFrames * 0.75),
    lastFrame,
  ];
  return Array.from(
    new Set(candidates.map((frame) => Math.max(0, Math.min(lastFrame, frame)))),
  ).sort((a, b) => a - b);
}

export async function measureCaptureCostFromSession(
  session: CaptureSession,
  totalFrames: number,
  fps: number,
  log?: ProducerLogger,
): Promise<{ estimate: CaptureCostEstimate; samples: CaptureCalibrationSample[] }> {
  const sampledFrames = selectCaptureCalibrationFrames(totalFrames);
  const samples: CaptureCalibrationSample[] = [];
  const totalSamples = sampledFrames.length;

  for (let i = 0; i < sampledFrames.length; i++) {
    const frameIndex = sampledFrames[i]!;
    log?.info(`Calibration: capturing test frame ${i + 1}/${totalSamples}...`);
    const time = frameIndex / fps;
    const startedAt = Date.now();
    const result = await captureFrameToBuffer(session, frameIndex, time);
    samples.push({
      frameIndex,
      captureTimeMs: result.captureTimeMs || Date.now() - startedAt,
    });
  }

  const estimate = estimateMeasuredCaptureCostMultiplier(samples);
  if (estimate.p95Ms !== undefined) {
    log?.info(`Calibration complete, estimated cost: ${estimate.p95Ms}ms/frame (p95)`);
  }

  return {
    estimate,
    samples,
  };
}

export function logCaptureCalibrationResult(
  calibration: { estimate: CaptureCostEstimate; samples: CaptureCalibrationSample[] },
  log: ProducerLogger,
): void {
  if (calibration.estimate.multiplier > 1) {
    log.warn("[Render] Measured slow frame capture during auto-worker calibration.", {
      multiplier: calibration.estimate.multiplier,
      p95Ms: calibration.estimate.p95Ms,
      sampledFrames: calibration.samples.map((sample) => sample.frameIndex),
    });
  } else {
    log.debug("[Render] Auto-worker calibration kept baseline capture cost.", {
      p95Ms: calibration.estimate.p95Ms,
      sampledFrames: calibration.samples.map((sample) => sample.frameIndex),
    });
  }
}

export type CaptureCalibrationFailureReason =
  | "calibration-failed"
  | "calibration-screenshot-failed";

export function createFailedCaptureCalibrationEstimate(reason: CaptureCalibrationFailureReason): {
  estimate: CaptureCostEstimate;
  samples: CaptureCalibrationSample[];
} {
  return {
    estimate: {
      multiplier: MAX_MEASURED_CAPTURE_COST_MULTIPLIER,
      reasons: [reason],
    },
    samples: [],
  };
}

export interface CaptureCalibrationOutcome {
  calibration: { estimate: CaptureCostEstimate; samples: CaptureCalibrationSample[] } | undefined;
  /** Flipped to `true` if BeginFrame calibration timed out and the screenshot retry fired. */
  forceScreenshot: boolean;
  /** Closed and nulled when the screenshot fallback fires; passthrough otherwise. */
  probeSession: CaptureSession | null;
  /** Buffer of whichever session was active last; the sequencer uses it for the error-path tail. */
  lastBrowserConsole: string[];
}

/**
 * Run the auto-worker capture-cost calibration, including the
 * BeginFrame → screenshot fallback on timeout. Owns the calibration
 * session lifecycle and may close the caller-owned `probeSession` when
 * the fallback fires (BeginFrame is no longer the active capture mode,
 * so the probe session is no longer reusable).
 */
// fallow-ignore-next-line complexity
export async function runCaptureCalibration(input: {
  cfg: EngineConfig;
  fileServer: FileServerHandle;
  workDir: string;
  log: ProducerLogger;
  job: RenderJob;
  totalFrames: number;
  forceScreenshot: boolean;
  probeSession: CaptureSession | null;
  buildCaptureOptions: () => CaptureOptions;
  createRenderVideoFrameInjector: () => BeforeCaptureHook | null;
  /** Throws `RenderCancelledError` when the caller's abort signal fires. */
  assertNotAborted: () => void;
}): Promise<CaptureCalibrationOutcome> {
  const {
    cfg,
    fileServer,
    workDir,
    log,
    job,
    totalFrames,
    buildCaptureOptions,
    createRenderVideoFrameInjector,
    assertNotAborted,
  } = input;
  let probeSession = input.probeSession;
  let forceScreenshot = input.forceScreenshot;
  let lastBrowserConsole: string[] = [];

  const fps = fpsToNumber(job.config.fps);
  // Holds whichever calibration session is currently open. The closure
  // writes into the outer `sessionRef` (an object) rather than a `let`
  // so the `finally` and the fallback branch read the latest value
  // without TS narrowing it back to the initial `null`.
  const sessionRef: { current: CaptureSession | null } = { current: null };

  const runOneCalibration = async (
    sessionDir: string,
    sessionCfg: EngineConfig,
  ): Promise<{ estimate: CaptureCostEstimate; samples: CaptureCalibrationSample[] }> => {
    log.info("Launching browser for capture calibration...");
    const session = await createCaptureSession(
      fileServer.url,
      sessionDir,
      buildCaptureOptions(),
      createRenderVideoFrameInjector(),
      sessionCfg,
    );
    sessionRef.current = session;
    if (!session.isInitialized) {
      log.info("Initializing calibration session...");
      const calInitStart = Date.now();
      const calHeartbeat = setInterval(() => {
        const elapsed = ((Date.now() - calInitStart) / 1000).toFixed(1);
        log.info(`Still waiting for browser initialization... (${elapsed}s elapsed)`);
      }, 30_000);
      try {
        await initializeSession(session);
      } finally {
        clearInterval(calHeartbeat);
      }
    }
    assertNotAborted();
    log.info("Calibration session ready, capturing test frames...");
    const result = await measureCaptureCostFromSession(session, totalFrames, fps, log);
    logCaptureCalibrationResult(result, log);
    return result;
  };

  const calibrationCfg = createCaptureCalibrationConfig({ ...cfg, forceScreenshot });
  let calibration:
    | { estimate: CaptureCostEstimate; samples: CaptureCalibrationSample[] }
    | undefined;

  try {
    calibration = await runOneCalibration(join(workDir, "capture-calibration"), calibrationCfg);
  } catch (error) {
    const shouldFallback =
      !forceScreenshot && shouldFallbackToScreenshotAfterCalibrationError(error);
    if (!shouldFallback) {
      calibration = createFailedCaptureCalibrationEstimate("calibration-failed");
      log.warn("[Render] Auto-worker calibration failed; using conservative worker budget.", {
        protocolTimeout: calibrationCfg.protocolTimeout,
        error: error instanceof Error ? error.message : String(error),
      });
    } else {
      // BeginFrame failed on this host's Chrome build; switch the rest
      // of the pipeline to screenshot capture. Flip only the local
      // boolean — `cfg` stays the compile-time view; downstream stages
      // receive the new value via the explicit `forceScreenshot` param.
      forceScreenshot = true;
      if (probeSession) {
        // Snapshot the probe buffer before closing — if the screenshot
        // session create that follows also fails, this is the only place
        // the BeginFrame-era diagnostic survives for the caller's
        // error-path browser-console tail.
        lastBrowserConsole = probeSession.browserConsoleBuffer;
        await closeCaptureSession(probeSession).catch(() => {});
        probeSession = null;
      }
      if (sessionRef.current) {
        lastBrowserConsole = sessionRef.current.browserConsoleBuffer;
        await closeCaptureSession(sessionRef.current).catch(() => {});
        sessionRef.current = null;
      }

      log.warn(
        "[Render] BeginFrame auto-worker calibration timed out; retrying calibration in screenshot capture mode.",
        {
          protocolTimeout: calibrationCfg.protocolTimeout,
          error: error instanceof Error ? error.message : String(error),
        },
      );

      const screenshotCfg = createCaptureCalibrationConfig({ ...cfg, forceScreenshot: true });
      try {
        calibration = await runOneCalibration(
          join(workDir, "capture-calibration-screenshot"),
          screenshotCfg,
        );
      } catch (fallbackError) {
        calibration = createFailedCaptureCalibrationEstimate("calibration-screenshot-failed");
        log.warn(
          "[Render] Screenshot auto-worker calibration failed after BeginFrame fallback; using conservative worker budget.",
          {
            protocolTimeout: screenshotCfg.protocolTimeout,
            error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
          },
        );
      }
    }
  } finally {
    if (sessionRef.current) {
      lastBrowserConsole = sessionRef.current.browserConsoleBuffer;
      await closeCaptureSession(sessionRef.current).catch(() => {});
    }
  }

  return { calibration, forceScreenshot, probeSession, lastBrowserConsole };
}

/**
 * Same as `runCaptureCalibration`'s error-classification check, but
 * exported separately because the sequencer also calls it from the
 * disk-capture retry loop. Returns `true` for the BeginFrame-specific
 * protocol errors that recover cleanly under screenshot mode.
 */
export function shouldFallbackToScreenshotAfterCalibrationError(error: unknown): boolean {
  const message = normalizeErrorMessage(error);
  return /HeadlessExperimental\.beginFrame timed out|beginFrame probe timeout|Another frame is pending|Frame still pending|Protocol error.*HeadlessExperimental\.beginFrame|Runtime\.callFunctionOn timed out|Runtime\.evaluate timed out/i.test(
    message,
  );
}
