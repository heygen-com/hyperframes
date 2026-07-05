// fallow-ignore-file code-duplication
import { execFileSync } from "child_process";
import { existsSync } from "fs";
import { resolve } from "path";

export const FFMPEG_PATH_ENV = "HYPERFRAMES_FFMPEG_PATH";
export const FFPROBE_PATH_ENV = "HYPERFRAMES_FFPROBE_PATH";

const pathCache = new Map<string, string | undefined>();

/**
 * Pick the binary path to use from `where`/`which`'s (newline-separated) output.
 *
 * On Windows `where ffmpeg` frequently lists a `.cmd`/`.bat` shim (npm/scoop/
 * winget wrappers) AHEAD of the real `.exe`. Node's spawn (no `shell:true`)
 * cannot execute a `.cmd`/`.bat` directly — it throws `spawn EINVAL` — which
 * surfaces as a render (and audio-mux) failure even though FFmpeg is installed.
 * So on win32 prefer the first directly-spawnable executable (`.exe`/`.com`),
 * falling back to the first result only when no such executable is listed
 * (preserving prior behavior rather than dropping a usable-via-shell path).
 * Pure and exported so the platform-specific selection is unit-testable.
 */
export function selectBinaryFromPathResults(output: string, platform: string): string | undefined {
  const candidates = output
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (candidates.length === 0) return undefined;
  if (platform === "win32") {
    const spawnable = candidates.find((p) => /\.(exe|com)$/i.test(p));
    return spawnable ?? candidates[0];
  }
  return candidates[0];
}

function findOnPath(name: "ffmpeg" | "ffprobe"): string | undefined {
  if (pathCache.has(name)) return pathCache.get(name);
  try {
    const command = process.platform === "win32" ? "where" : "which";
    const output = execFileSync(command, [name], {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 5000,
    });
    const selected = selectBinaryFromPathResults(output, process.platform);
    const resolved = selected ? resolve(selected) : undefined;
    pathCache.set(name, resolved);
    return resolved;
  } catch {
    pathCache.set(name, undefined);
    return undefined;
  }
}

function getConfiguredBinary(envName: string, binaryName: "ffmpeg" | "ffprobe"): string {
  const configured = process.env[envName]?.trim();
  if (configured) return resolve(configured);
  return findOnPath(binaryName) ?? binaryName;
}

export function getFfmpegBinary(): string {
  return getConfiguredBinary(FFMPEG_PATH_ENV, "ffmpeg");
}

export function getFfprobeBinary(): string {
  return getConfiguredBinary(FFPROBE_PATH_ENV, "ffprobe");
}

export function assertConfiguredFfmpegBinariesExist(): void {
  const ffmpegPath = process.env[FFMPEG_PATH_ENV]?.trim();
  if (ffmpegPath && !existsSync(ffmpegPath)) {
    throw new Error(
      `[FFmpeg] FFmpeg binary not found at ${FFMPEG_PATH_ENV}="${ffmpegPath}". ` +
        "Install FFmpeg or unset the override.",
    );
  }

  const ffprobePath = process.env[FFPROBE_PATH_ENV]?.trim();
  if (ffprobePath && !existsSync(ffprobePath)) {
    throw new Error(
      `[FFmpeg] FFprobe binary not found at ${FFPROBE_PATH_ENV}="${ffprobePath}". ` +
        "Install FFmpeg or unset the override.",
    );
  }
}
