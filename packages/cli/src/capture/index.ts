import { createCaptureWatchdog, runWithWatchdog } from "./captureWatchdog.js";
import { createPartialCaptureState, writePartialCaptureBundle } from "./partialCapture.js";
import type { PartialCaptureState } from "./partialCapture.js";
import { captureWebsiteAttempt } from "./captureAttempt.js";
import { NavigationDeadlineError } from "./captureErrors.js";
import type { CaptureOptions, CaptureResult } from "./types.js";

export type { CaptureOptions, CaptureResult } from "./types.js";

export async function captureWebsite(
  opts: CaptureOptions,
  onProgress?: (stage: string, detail?: string) => void,
): Promise<CaptureResult> {
  const watchdog = createCaptureWatchdog(opts.captureDeadlineMs);
  const state = createPartialCaptureState(opts);
  const attempt = captureWebsiteAttempt(opts, onProgress, false, watchdog, state);
  try {
    const first = await runWithWatchdog(attempt, watchdog.promise);
    if (first.kind === "deadline") return deadlineResult(opts, state);
    if (first.kind === "error") throw first.error;
    return first.result;
  } catch (err) {
    if (!(err instanceof NavigationDeadlineError) || watchdog.expired()) throw err;
    onProgress?.("warn", "Navigation timed out; retrying once with WebGL disabled");
    opts.onPhase?.({
      schema: "hyperframes.capture.phase.v1",
      phase: "navigation",
      status: "degraded",
      remainingMs: null,
      reason: "webgl-disabled-retry",
    });
    const retry = captureWebsiteAttempt(opts, onProgress, true, watchdog, state);
    const second = await runWithWatchdog(retry, watchdog.promise);
    if (second.kind === "deadline") return deadlineResult(opts, state);
    if (second.kind === "error") throw second.error;
    return second.result;
  } finally {
    watchdog.dispose();
  }
}

function deadlineResult(opts: CaptureOptions, state: PartialCaptureState): CaptureResult {
  const lastPhase = {
    schema: "hyperframes.capture.phase.v1" as const,
    phase: "complete" as const,
    status: "degraded" as const,
    remainingMs: null,
    reason: "deadline" as const,
  };
  opts.onPhase?.(lastPhase);
  return writePartialCaptureBundle(opts, state, lastPhase);
}

// visual-style.md and capture-summary.md generators removed — DESIGN.md replaces them
