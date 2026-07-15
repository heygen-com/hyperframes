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

export interface RunFfmpegOptions {
  signal?: AbortSignal;
  timeout?: number;
  onStderr?: (line: string) => void;
}

export interface RunFfmpegResult {
  success: boolean;
  exitCode: number | null;
  stderr: string;
  durationMs: number;
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
  const startMs = Date.now();
  const signal = opts?.signal;
  const timeout = opts?.timeout ?? DEFAULT_TIMEOUT;
  const onStderr = opts?.onStderr;

  return new Promise<RunFfmpegResult>((resolve) => {
    const ffmpeg = spawn(getFfmpegBinary(), args);
    trackChildProcess(ffmpeg);
    let stderr = "";

    const onAbort = () => {
      ffmpeg.kill("SIGTERM");
    };

    if (signal) {
      if (signal.aborted) {
        ffmpeg.kill("SIGTERM");
      } else {
        signal.addEventListener("abort", onAbort, { once: true });
      }
    }

    const timer = setTimeout(() => {
      ffmpeg.kill("SIGTERM");
    }, timeout);

    ffmpeg.stderr.on("data", (data: Buffer) => {
      const chunk = data.toString();
      stderr += chunk;
      if (onStderr) {
        onStderr(chunk);
      }
    });

    ffmpeg.on("close", (code) => {
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", onAbort);
      resolve({
        success: !signal?.aborted && code === 0,
        exitCode: code,
        stderr,
        durationMs: Date.now() - startMs,
      });
    });

    ffmpeg.on("error", (err) => {
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", onAbort);
      resolve({
        success: false,
        exitCode: null,
        stderr: err.message,
        durationMs: Date.now() - startMs,
      });
    });
  });
}
