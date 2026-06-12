// fallow-ignore-file code-duplication
import { execFileSync } from "child_process";
import { existsSync } from "fs";
import { resolve } from "path";

export const FFMPEG_PATH_ENV = "HYPERFRAMES_FFMPEG_PATH";
export const FFPROBE_PATH_ENV = "HYPERFRAMES_FFPROBE_PATH";

const pathCache = new Map<string, string | undefined>();

function findOnPath(name: "ffmpeg" | "ffprobe"): string | undefined {
  if (pathCache.has(name)) return pathCache.get(name);
  try {
    const command = process.platform === "win32" ? "where" : "which";
    const output = execFileSync(command, [name], {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 5000,
    });
    const first = output
      .split(/\r?\n/)
      .map((s) => s.trim())
      .find(Boolean);
    const resolved = first ? resolve(first) : undefined;
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
