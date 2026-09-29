import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getFfmpegBinary } from "./ffmpegBinaries.js";

/**
 * Preflight for the ffmpeg `psnr` filter used by drawElement self-verify
 * (see `psnr.ts`). Some host ffmpeg builds ship without `libpostproc` and
 * silently omit the filter — every downstream `psnrDb()` call then throws
 * mid-render and the disk-sample verifier swallows it (fail-open safety net).
 * A cached one-shot probe surfaces the shape once, at bootstrap, so the
 * capture-session router can force-fallback to the reliable screenshot path
 * instead of arming a drawElement render whose safety net cannot run.
 *
 * Cache lifetime is the current process: an operator's ffmpeg install does
 * not change across renders within the same CLI invocation, and re-probing
 * per session would burn ~50-100ms of subprocess spawn per capture worker.
 */
let cachedFilterList: Promise<string | null> | null = null;

/**
 * Returns true when the resident ffmpeg exposes the `psnr` filter. False on
 * any probe failure — missing binary (ENOENT), non-zero exit, timeout,
 * unparseable output — because in every case the drawElement self-verify
 * path cannot function. Never rejects.
 *
 * Result is memoized per process; call {@link resetPsnrFilterAvailabilityCache}
 * from tests that need to re-probe.
 */
export function isPsnrFilterAvailable(): Promise<boolean> {
  return isFfmpegFilterAvailable("psnr");
}

export async function isFfmpegFilterAvailable(name: string): Promise<boolean> {
  if (cachedFilterList === null) cachedFilterList = listFilters();
  const stdout = await cachedFilterList;
  // `-filters` lists one filter per line; a whole-word match ignores longer names
  // and banner prose that mentions the filter.
  return stdout !== null && new RegExp(`(^|\\s)${name}(\\s|$)`, "m").test(stdout);
}

/** Test-only: drop the memoized probe result. */
export function resetPsnrFilterAvailabilityCache(): void {
  cachedFilterList = null;
}

async function listFilters(): Promise<string | null> {
  // Match `psnr.ts`: promisify lazily so a partial `node:child_process` mock
  // (test that omits `execFile`) doesn't crash at module load — it fails at
  // call time instead, and the try/catch below reports no filters at all.
  const execFileP = promisify(execFile);
  try {
    const { stdout } = await execFileP(getFfmpegBinary(), ["-hide_banner", "-filters"], {
      maxBuffer: 4 * 1024 * 1024,
      timeout: 5_000,
    });
    return stdout;
  } catch {
    return null;
  }
}
