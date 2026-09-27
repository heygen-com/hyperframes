/**
 * Errno classification and message formatting for transient Windows
 * spawn failures. See ffSpawnRetry.ts for the retry loop that consumes these.
 */

/**
 * Errnos whose spawn failure is transient on Windows: the binary file is
 * briefly locked — overwhelmingly antivirus real-time scanning a just-written
 * or just-executed exe, occasionally a lingering handle from a concurrent
 * sibling invocation (the Delivery transcoder and the render pipeline share
 * one managed ffmpeg.exe). A short backoff and a fresh spawn succeeds; the
 * historical behavior surfaced a bare, context-free "spawn EBUSY" and failed
 * the whole render.
 */
export const TRANSIENT_SPAWN_ERRNOS: ReadonlySet<string> = new Set([
  "EBUSY",
  "ETXTBSY",
  "EAGAIN",
  "EMFILE",
  "ENFILE",
]);

export function isTransientSpawnErrno(code: string | undefined): boolean {
  return code !== undefined && TRANSIENT_SPAWN_ERRNOS.has(code);
}

/** Exponential backoff for the retry loop: `baseMs` × 2^attempt. */
export function fileLockRetryDelayMs(attempt: number, baseMs: number): number {
  return baseMs * 2 ** attempt;
}

export function describeSpawnFailure(
  binary: string,
  error: NodeJS.ErrnoException,
  attemptsMade: number,
): string {
  const lockHint = isTransientSpawnErrno(error.code)
    ? " (transient file lock — often antivirus real-time scanning; retries did not clear it)"
    : "";
  return `Failed to spawn "${binary}" after ${attemptsMade} attempt(s): ${error.message}${lockHint}`;
}
