import { renameSync } from "node:fs";
import { rename } from "node:fs/promises";

// Windows reports EPERM/EACCES/EBUSY while antivirus or a just-exited process still holds the
// file; the hold clears within milliseconds. Total wait before giving up: about 1.3 s.
const RETRYABLE = new Set(["EPERM", "EACCES", "EBUSY"]);
const BACKOFF_MS = [10, 20, 40, 80, 160, 320, 640];

interface Options {
  platform?: NodeJS.Platform;
}

function isRetryable(error: unknown, platform: NodeJS.Platform): boolean {
  if (platform !== "win32") return false;
  return RETRYABLE.has((error as NodeJS.ErrnoException | undefined)?.code ?? "");
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** `renameSync` that rides out Windows' transient file locks; other platforms and errors throw at once. */
export function renameWithRetry(
  from: string,
  to: string,
  options: Options & { rename?: (from: string, to: string) => void } = {},
): void {
  const doRename = options.rename ?? renameSync;
  const platform = options.platform ?? process.platform;
  for (let attempt = 0; ; attempt++) {
    try {
      doRename(from, to);
      return;
    } catch (error) {
      if (attempt >= BACKOFF_MS.length || !isRetryable(error, platform)) throw error;
      sleepSync(BACKOFF_MS[attempt]!);
    }
  }
}

/** Async twin of {@link renameWithRetry}. */
export async function renameWithRetryAsync(
  from: string,
  to: string,
  options: Options & { rename?: (from: string, to: string) => Promise<void> } = {},
): Promise<void> {
  const doRename = options.rename ?? rename;
  const platform = options.platform ?? process.platform;
  for (let attempt = 0; ; attempt++) {
    try {
      await doRename(from, to);
      return;
    } catch (error) {
      if (attempt >= BACKOFF_MS.length || !isRetryable(error, platform)) throw error;
      await new Promise((resolve) => setTimeout(resolve, BACKOFF_MS[attempt]));
    }
  }
}
