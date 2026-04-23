/**
 * Shared FFmpeg process runner.
 *
 * Extracts the repeated spawn-stderr-timeout-abort-close-error pattern
 * that appears across audioMixer and chunkEncoder into a single helper.
 */

import { spawn } from "child_process";

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
    const ffmpeg = spawn("ffmpeg", args);
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
