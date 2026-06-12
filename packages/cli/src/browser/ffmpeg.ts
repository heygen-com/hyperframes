// fallow-ignore-file code-duplication
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

export const FFMPEG_PATH_ENV = "HYPERFRAMES_FFMPEG_PATH";
export const FFPROBE_PATH_ENV = "HYPERFRAMES_FFPROBE_PATH";

function findOnPath(name: "ffmpeg" | "ffprobe"): string | undefined {
  try {
    const cmd = process.platform === "win32" ? `where ${name}` : `which ${name}`;
    const output = execSync(cmd, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 5000,
    });
    const first = output
      .split(/\r?\n/)
      .map((s) => s.trim())
      .find(Boolean);
    return first ? resolve(first) : undefined;
  } catch {
    return undefined;
  }
}

function findConfiguredBinary(
  envName: string,
  binaryName: "ffmpeg" | "ffprobe",
): string | undefined {
  const configured = process.env[envName]?.trim();
  if (configured) return existsSync(configured) ? resolve(configured) : undefined;
  return findOnPath(binaryName);
}

export function findFFmpeg(): string | undefined {
  return findConfiguredBinary(FFMPEG_PATH_ENV, "ffmpeg");
}

export function findFFprobe(): string | undefined {
  return findConfiguredBinary(FFPROBE_PATH_ENV, "ffprobe");
}

export function getFFmpegInstallHint(): string {
  switch (process.platform) {
    case "darwin":
      return "brew install ffmpeg";
    case "linux":
      return "sudo apt install ffmpeg";
    case "win32":
      return "Download the 64-bit Windows build from https://ffmpeg.org/download.html#build-windows and add its bin/ directory to PATH.";
    default:
      return "https://ffmpeg.org/download.html";
  }
}
