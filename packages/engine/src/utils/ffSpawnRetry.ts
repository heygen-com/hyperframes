/**
 * Transient spawn-failure retry for the ffmpeg/ffprobe binaries.
 *
 * On Windows, spawning can fail with EBUSY/ETXTBSY when the binary file is
 * briefly locked — overwhelmingly antivirus real-time scanning a just-written
 * or just-executed exe, occasionally a lingering handle from a concurrent
 * sibling invocation (the Delivery transcoder and the render pipeline share
 * one managed ffmpeg.exe). A short backoff and a fresh spawn succeeds; the
 * historical behavior surfaced a bare, context-free "spawn EBUSY" and failed
 * the whole render.
 *
 * The retry wraps each caller's existing spawn-and-wait flow instead of the
 * raw `spawn()` call, so a healthy spawn path keeps its exact synchronous
 * timing (callers construct their ManagedChildProcess right after spawn, and
 * several tests choreograph fake timers against that ordering).
 */
import {
  describeSpawnFailure,
  fileLockRetryDelayMs,
  isTransientSpawnErrno,
} from "./ffSpawnErrno.js";

export {
  isTransientSpawnErrno,
  describeSpawnFailure,
  fileLockRetryDelayMs,
  TRANSIENT_SPAWN_ERRNOS,
} from "./ffSpawnErrno.js";

export interface TransientSpawnRetryOptions {
  /** Total attempts including the first, default 3. */
  attempts?: number;
  /** Base backoff, doubled per attempt, default 250ms. */
  backoffMs?: number;
  onRetry?: (attempt: number, nextAttemptInMs: number, error: NodeJS.ErrnoException) => void;
}

interface RetryPlan {
  attempts: number;
  backoffMs: number;
  onRetry?: TransientSpawnRetryOptions["onRetry"];
}

function resolveRetryPlan(options: TransientSpawnRetryOptions): RetryPlan {
  return {
    attempts: Math.max(1, options.attempts ?? 3),
    backoffMs: options.backoffMs ?? 250,
    onRetry: options.onRetry,
  };
}

/**
 * Throws enriched for permanent failures, delays and returns for retries —
 * a `void` return after a transient error means "loop and try again".
 */
async function handleThrownSpawnError(
  binary: string,
  error: NodeJS.ErrnoException,
  attemptIndex: number,
  plan: RetryPlan,
): Promise<void> {
  if (!isTransientSpawnErrno(error?.code)) throw error;
  // `attemptIndex` is 0-based; the next attempt would be number
  // `attemptIndex + 2` — past the plan means the retries are exhausted.
  if (attemptIndex + 2 > plan.attempts) {
    throw Object.assign(new Error(describeSpawnFailure(binary, error, attemptIndex + 1)), {
      code: error.code,
      cause: error,
    });
  }
  await scheduleRetry(binary, error, attemptIndex, plan);
}

async function scheduleRetry(
  binary: string,
  error: NodeJS.ErrnoException,
  attemptIndex: number,
  plan: RetryPlan,
): Promise<void> {
  const nextAttempt = attemptIndex + 2;
  const delayMs = fileLockRetryDelayMs(attemptIndex, plan.backoffMs);
  plan.onRetry?.(nextAttempt - 1, delayMs, error);
  console.warn(
    `[ffSpawn] spawn "${binary}" failed with ${error.code ?? "unknown errno"}; ` +
      `retrying (attempt ${nextAttempt}/${plan.attempts})`,
  );
  await new Promise((resolveTimer) => setTimeout(resolveTimer, delayMs));
}

/**
 * Re-run `attempt` while its failure is a transient spawn file-lock error.
 *
 * `getTransientError` reports the errno when `attempt`'s RESULT is a spawn
 * failure (the runFfmpeg/ManagedChildProcess shape, where the error arrives
 * as part of the outcome rather than as a rejection); a rejection carrying a
 * transient `code` (the manual-wiring shape, audioExtractor) is retried too.
 * Non-transient failures pass through untouched after the first attempt.
 */
export async function withTransientSpawnRetry<T>(
  binary: string,
  attempt: (attemptIndex: number) => Promise<T>,
  getTransientError: (result: T) => NodeJS.ErrnoException | undefined,
  options: TransientSpawnRetryOptions = {},
): Promise<T> {
  const plan = resolveRetryPlan(options);
  for (let attemptIndex = 0; ; attemptIndex++) {
    let result: T;
    try {
      result = await attempt(attemptIndex);
    } catch (error) {
      await handleThrownSpawnError(binary, error as NodeJS.ErrnoException, attemptIndex, plan);
      continue;
    }
    const transientError = getTransientError(result);
    if (!transientError) return result;
    if (attemptIndex + 2 > plan.attempts) return result;
    await scheduleRetry(binary, transientError, attemptIndex, plan);
  }
}
