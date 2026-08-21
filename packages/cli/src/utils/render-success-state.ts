/**
 * Shared render-success sentinel + post-artifact-validated cleanup guards.
 *
 * Read by the top-level CLI process handlers (uncaughtException /
 * unhandledRejection) to sanitize the exit code when a post-artifact-validated
 * cleanup step throws.
 *
 * Set by the render command AFTER `executeRenderJob` (or the Docker child
 * render) resolves cleanly — the point at which the artifact has been
 * validated AND committed to disk. Any throw after this point (worker
 * teardown, browser shutdown, telemetry flush, feedback prompt, stray
 * promise rejection) must not turn a valid render into an exit-1
 * "no final error message" failure.
 *
 * Field signal (all win32/x64, CLI 0.7.58, ffmpeg=no, 1080x1920 renders):
 *   - ts=1784169760 — 6-worker capture retried down after Runtime.evaluate
 *     timeout, completed all 1260 frames, printed 'artifact validated',
 *     exited 1 with no final error message. Output MP4 valid on disk.
 *   - ts=1784171150 — full REPRO command provided; identical shape.
 *   - ts=1784172467 — `--workers 2`, identical shape.
 * All three: ffprobe + visual QA confirmed the output was valid; the CLI
 * still exited 1 after the terminal "artifact validated" checkpoint.
 */

import { sanitizeSuccessfulExitCode } from "./commandResult.js";

let renderSucceeded = false;

/**
 * Called by the render command after the producer's `executeRenderJob` (or
 * the Docker child) resolves cleanly. From this point on, any thrown
 * teardown error must not be allowed to override the exit code.
 */
export function markRenderSucceeded(): void {
  renderSucceeded = true;
}

/**
 * Read by cli.ts process handlers to decide whether a late throw is fatal.
 * When true, the handlers log the throw at warn level (so it's still visible
 * for diagnosis) but do not surface it as an exit-1 failure.
 */
export function isRenderSucceeded(): boolean {
  return renderSucceeded;
}

/** Test-only reset. Not exported from the package. */
export function _resetRenderSuccessForTests(): void {
  renderSucceeded = false;
}

type PostRenderErrorSink = (message: string) => void;

const defaultErrorSink: PostRenderErrorSink = (message) => {
  process.stderr.write(`${message}\n`);
};

/**
 * Run a post-artifact-validated cleanup step so a throw cannot flip the CLI
 * exit code. `markRenderSucceeded()` MUST have been called first — this
 * helper is only safe on the success path where the artifact is already
 * committed to disk. Logs a compact warning to stderr, asks the root CLI to
 * clear a stray exit code, and swallows the error.
 */
export function runPostRenderStep(
  label: string,
  fn: () => void,
  sink: PostRenderErrorSink = defaultErrorSink,
): void {
  try {
    fn();
  } catch (err) {
    reportPostRenderStepFailure(label, err, sink);
  }
}

export async function runPostRenderStepAsync(
  label: string,
  fn: () => Promise<void>,
  sink: PostRenderErrorSink = defaultErrorSink,
): Promise<void> {
  try {
    await fn();
  } catch (err) {
    reportPostRenderStepFailure(label, err, sink);
  }
}

function reportPostRenderStepFailure(label: string, err: unknown, sink: PostRenderErrorSink): void {
  const message = err instanceof Error ? err.message : String(err);
  sink(`  [hyperframes] Post-render step '${label}' failed (render already succeeded): ${message}`);
  // The failing step (or something it triggered) may have set a non-zero
  // exitCode. The render succeeded, so ask the root CLI owner to clear it.
  sanitizeSuccessfulExitCode();
}
