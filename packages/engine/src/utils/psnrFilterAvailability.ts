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
let cached: Promise<boolean> | null = null;

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
  if (cached === null) cached = probe();
  return cached;
}

/** Test-only: drop the memoized probe result. */
export function resetPsnrFilterAvailabilityCache(): void {
  cached = null;
}

async function probe(): Promise<boolean> {
  // Match `psnr.ts`: promisify lazily so a partial `node:child_process` mock
  // (test that omits `execFile`) doesn't crash at module load — it fails at
  // call time instead, and the try/catch below converts that to `false`.
  const execFileP = promisify(execFile);
  try {
    const { stdout } = await execFileP(getFfmpegBinary(), ["-hide_banner", "-filters"], {
      maxBuffer: 4 * 1024 * 1024,
      timeout: 5_000,
    });
    // ffmpeg's `-filters` output lists one filter per line, e.g.
    //   " T.. psnr             VV->V      Calculate the PSNR between two video streams."
    // A whole-word match keeps `multi-psnr` (hypothetical) from masquerading
    // as the real filter, and dodges the banner text that mentions PSNR in
    // prose on some builds.
    return /(^|\s)psnr(\s|$)/m.test(stdout);
  } catch {
    return false;
  }
}
