// fallow-ignore-file code-duplication
/**
 * Shared FFmpeg process runner.
 *
 * Extracts the repeated spawn-stderr-timeout-abort-close-error pattern
 * that appears across audioMixer and chunkEncoder into a single helper.
 */

import { spawn } from "child_process";
import { getFfmpegBinary } from "./ffmpegBinaries.js";
import { trackChildProcess } from "./processTracker.js";
import {
  ManagedChildProcess,
  type ManagedProcessTerminationReason,
} from "./managedChildProcess.js";

export interface RunFfmpegOptions {
  signal?: AbortSignal;
  timeout?: number;
  onStderr?: (line: string) => void;
}

export interface RunFfmpegResult {
  success: boolean;
  exitCode: number | null;
  signal?: NodeJS.Signals | null;
  stderr: string;
  durationMs: number;
  terminationReason: ManagedProcessTerminationReason;
  failureReason?: "external_interruption";
  error?: Error;
}

const FFMPEG_SIGTERM_EXIT_LINE = /^Exiting normally, received signal 15\.?\r?$/m;

/**
 * Return true only when ffmpeg was terminated from outside this managed call.
 *
 * FFmpeg handles SIGTERM itself and can therefore report exit code 255 with a
 * null Node signal. The exact terminal stderr line covers that case. Managed
 * abort/deadline/inactivity reasons always take precedence so our own SIGTERM
 * requests never become retryable lifecycle interruptions.
 */
export function isExternalFfmpegInterruption(
  result: Pick<RunFfmpegResult, "exitCode" | "signal" | "stderr" | "terminationReason">,
): boolean {
  if (result.terminationReason !== "exit" || result.exitCode === 0) return false;
  if (result.signal === "SIGTERM") return true;
  return result.exitCode === 255 && FFMPEG_SIGTERM_EXIT_LINE.test(result.stderr);
}

const DEFAULT_TIMEOUT = 300_000;

const DEFAULT_STDERR_TAIL_LINES = 15;

function formatWindowsFfmpegExit(exitCode: number | null): string | undefined {
  if (process.platform !== "win32" || exitCode === null) return undefined;
  if (exitCode === 3221225781 || exitCode === -1073741515) {
    const ffmpegPath = getFfmpegBinary();
    return (
      `[FFmpeg] Windows could not start "${ffmpegPath}": ` +
      "0xC0000135 (STATUS_DLL_NOT_FOUND). A required DLL could not be loaded. " +
      "Install a working 64-bit Windows FFmpeg build with all required runtime DLLs."
    );
  }
  if (exitCode === 3221225595 || exitCode === -1073741701) {
    return (
      "[FFmpeg] Windows could not start ffmpeg.exe (STATUS_INVALID_IMAGE_FORMAT). " +
      "The binary may be corrupted or the wrong architecture. Reinstall a 64-bit Windows FFmpeg build."
    );
  }
  if (exitCode === 3221225794 || exitCode === -1073741502) {
    return (
      "[FFmpeg] Windows failed while initializing ffmpeg.exe. " +
      "The binary may be corrupted, blocked, or missing runtime DLLs. Reinstall a 64-bit Windows FFmpeg build."
    );
  }
  return undefined;
}

/**
 * Build a user-facing error message for a failed ffmpeg invocation.
 *
 * Historically we reported only `FFmpeg exited with code N`, which is useless
 * for diagnosing encoder-options failures — a rejected `-preset` surfaces as a
 * bare `code -22` with no hint at which argument ffmpeg objected to. Including
 * the tail of stderr turns those into a one-line signal (e.g.
 * `Error applying encoder options: Invalid argument`) that tells the caller
 * exactly which option to fix.
 */
export function formatFfmpegError(
  exitCode: number | null,
  stderr: string,
  tailLines: number = DEFAULT_STDERR_TAIL_LINES,
): string {
  const tail = (stderr ?? "")
    .split(/\r?\n/)
    .filter((line) => line.length > 0)
    .slice(-tailLines)
    .join("\n");
  if (exitCode === null) {
    return tail ? `[FFmpeg] ${tail}` : "[FFmpeg] process error";
  }
  const windowsMessage = formatWindowsFfmpegExit(exitCode);
  if (windowsMessage) {
    return tail ? `${windowsMessage}\nffmpeg stderr (tail):\n${tail}` : windowsMessage;
  }
  return tail
    ? `FFmpeg exited with code ${exitCode}\nffmpeg stderr (tail):\n${tail}`
    : `FFmpeg exited with code ${exitCode}`;
}

export async function runFfmpeg(args: string[], opts?: RunFfmpegOptions): Promise<RunFfmpegResult> {
  const timeout = opts?.timeout ?? DEFAULT_TIMEOUT;
  // windowsHide: ffmpeg/ffprobe are console-subsystem binaries, so without
  // this Node opens a visible console window per spawn on Windows. A render
  // shells out dozens of times across parallel workers, which flashes a burst
  // of windows across the user's desktop. No-op on macOS and Linux.
  const ffmpeg = spawn(getFfmpegBinary(), args, { windowsHide: true });
  trackChildProcess(ffmpeg);
  const managed = new ManagedChildProcess(ffmpeg, {
    signal: opts?.signal,
    deadlineAtMs: Date.now() + timeout,
    onStderr: opts?.onStderr,
  });
  const outcome = await managed.wait();
  const result: RunFfmpegResult = {
    success: outcome.reason === "exit" && outcome.exitCode === 0,
    exitCode: outcome.exitCode,
    signal: outcome.signal,
    stderr: outcome.stderr,
    durationMs: outcome.durationMs,
    terminationReason: outcome.reason,
    error: outcome.error,
  };
  if (isExternalFfmpegInterruption(result)) {
    result.failureReason = "external_interruption";
  }
  return result;
}
