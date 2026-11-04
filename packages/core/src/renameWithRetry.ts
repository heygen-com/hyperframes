import { copyFileSync, renameSync } from "node:fs";
import { copyFile, rename } from "node:fs/promises";
import { removeScratch } from "./removeScratch.js";

// Windows reports EPERM/EACCES/EBUSY while antivirus or a just-exited process still holds the
// file; the hold clears within milliseconds. Total wait before giving up: about 1.3 s.
const RETRYABLE = new Set(["EPERM", "EACCES", "EBUSY"]);
const BACKOFF_MS = [10, 20, 40, 80, 160, 320, 640];

interface Options {
  platform?: NodeJS.Platform;
  /** Copy the bytes when Windows keeps refusing (a TEMP that denies delete). Not atomic: scratch files only. */
  copyFallback?: boolean;
}

export function isWindowsHold(error: unknown, platform = process.platform): boolean {
  if (platform !== "win32") return false;
  return RETRYABLE.has((error as NodeJS.ErrnoException | undefined)?.code ?? "");
}

/** What a refused rename does next: wait and try again, fall back to a copy, or give up with the error. */
function nextStep(error: unknown, attempt: number, options: Options, platform: NodeJS.Platform) {
  if (!isWindowsHold(error, platform)) return "throw";
  if (attempt < BACKOFF_MS.length) return "wait";
  return options.copyFallback ? "copy" : "throw";
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** `renameSync` that rides out Windows' transient file locks; other platforms and errors throw at once. */
export function renameWithRetry(
  from: string,
  to: string,
  options: Options & {
    rename?: (from: string, to: string) => void;
    copy?: (from: string, to: string) => void;
  } = {},
): void {
  const doRename = options.rename ?? renameSync;
  const doCopy = options.copy ?? copyFileSync;
  const platform = options.platform ?? process.platform;
  for (let attempt = 0; ; attempt++) {
    try {
      doRename(from, to);
      return;
    } catch (error) {
      const step = nextStep(error, attempt, options, platform);
      if (step === "throw") throw error;
      if (step === "wait") {
        sleepSync(BACKOFF_MS[attempt]!);
        continue;
      }
      try {
        doCopy(from, to);
      } catch {
        throw error;
      }
      removeScratch(from);
      return;
    }
  }
}

/** Async twin of {@link renameWithRetry}. */
export async function renameWithRetryAsync(
  from: string,
  to: string,
  options: Options & {
    rename?: (from: string, to: string) => Promise<void>;
    copy?: (from: string, to: string) => Promise<void>;
  } = {},
): Promise<void> {
  const doRename = options.rename ?? rename;
  const doCopy = options.copy ?? copyFile;
  const platform = options.platform ?? process.platform;
  for (let attempt = 0; ; attempt++) {
    try {
      await doRename(from, to);
      return;
    } catch (error) {
      const step = nextStep(error, attempt, options, platform);
      if (step === "throw") throw error;
      if (step === "wait") {
        await new Promise((resolve) => setTimeout(resolve, BACKOFF_MS[attempt]));
        continue;
      }
      try {
        await doCopy(from, to);
      } catch {
        throw error;
      }
      removeScratch(from);
      return;
    }
  }
}
