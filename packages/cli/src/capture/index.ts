import { createCaptureWatchdog, runWithWatchdog } from "./captureWatchdog.js";
import { createPartialCaptureState, writePartialCaptureBundle } from "./partialCapture.js";
import type { PartialCaptureState } from "./partialCapture.js";
import { captureWebsiteAttempt } from "./captureAttempt.js";
import {
  localUrlRewriter,
  resolveLocalCaptureTarget,
  rewriteLocalCaptureOutput,
  rewriteStrings,
  startLocalPageServer,
} from "./localPage.js";
import { NavigationDeadlineError } from "./captureErrors.js";
import { CAPTURE_PHASE_SCHEMA } from "./types.js";
import type { CaptureOptions, CaptureResult } from "./types.js";

export type { CaptureOptions, CaptureResult } from "./types.js";

export async function captureWebsite(
  opts: CaptureOptions,
  onProgress?: (stage: string, detail?: string) => void,
): Promise<CaptureResult> {
  if (opts.localFile === undefined) {
    if (opts.localRoot !== undefined) throw new Error("localRoot requires localFile");
    return captureTarget(opts, onProgress);
  }
  const local = resolveLocalCaptureTarget(opts.localFile, opts.localRoot);
  const server = await startLocalPageServer(local);
  const rewrite = localUrlRewriter(server.origin, local.root);
  try {
    const result = await captureTarget({ ...opts, url: server.url }, onProgress, server.origin);
    return { ...rewriteStrings(result, rewrite), url: local.fileUrl };
  } finally {
    await server.close();
    rewriteLocalCaptureOutput(opts.outputDir, rewrite, local.fileUrl);
  }
}

async function captureTarget(
  opts: CaptureOptions,
  onProgress: ((stage: string, detail?: string) => void) | undefined,
  localOrigin?: string,
): Promise<CaptureResult> {
  const watchdog = createCaptureWatchdog(opts.captureDeadlineMs);
  const state = createPartialCaptureState(opts);
  const run = (disableWebgl: boolean) =>
    captureWebsiteAttempt(opts, onProgress, disableWebgl, watchdog, state, localOrigin);
  const settle = async (attempt: Promise<CaptureResult>): Promise<CaptureResult> => {
    const outcome = await runWithWatchdog(attempt, watchdog.promise);
    if (outcome.kind === "deadline") return deadlineResult(opts, state);
    if (outcome.kind === "error") throw outcome.error;
    return outcome.result;
  };
  try {
    return await settle(run(false));
  } catch (err) {
    const navigationStalled = err instanceof NavigationDeadlineError && err.webglObserved;
    if (!(navigationStalled || state.webglStalled) || watchdog.expired()) throw err;
    const why = navigationStalled ? "Navigation timed out" : "The page stopped answering";
    state.webglStalled = false;
    onProgress?.("warn", `${why}; retrying once with WebGL disabled`);
    state.warnings.push(`${why}; retrying once with WebGL disabled`);
    opts.onPhase?.({
      schema: CAPTURE_PHASE_SCHEMA,
      phase: "navigation",
      status: "degraded",
      remainingMs: null,
      reason: "webgl-disabled-retry",
    });
    const second = await settle(run(true));
    return { ...second, warnings: [...new Set([...state.warnings, ...second.warnings])] };
  } finally {
    watchdog.dispose();
  }
}

function deadlineResult(opts: CaptureOptions, state: PartialCaptureState): CaptureResult {
  const lastPhase = {
    schema: CAPTURE_PHASE_SCHEMA,
    phase: "complete" as const,
    status: "degraded" as const,
    remainingMs: null,
    reason: "deadline" as const,
  };
  opts.onPhase?.(lastPhase);
  return writePartialCaptureBundle(opts, state, lastPhase);
}

// visual-style.md and capture-summary.md generators removed — DESIGN.md replaces them
