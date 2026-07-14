// fallow-ignore-file code-duplication
import { execFileSync, execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { detectLinuxDistro, ffmpegInstallCommand } from "./linuxDeps.js";

export const FFMPEG_PATH_ENV = "HYPERFRAMES_FFMPEG_PATH";
export const FFPROBE_PATH_ENV = "HYPERFRAMES_FFPROBE_PATH";

export type H264EncoderMode = "software" | "gpu";

/**
 * Select the H.264 encoder class supported by an FFmpeg build.
 *
 * Some macOS FFmpeg distributions expose VideoToolbox but omit libx264. The
 * default CPU render path must not pass libx264-only options such as `-preset`
 * to those builds.
 */
export function resolveH264EncoderMode(
  ffmpegEncodersOutput: string,
  gpuRequested: boolean,
): H264EncoderMode {
  if (gpuRequested) return "gpu";
  if (/\blibx264\b/.test(ffmpegEncodersOutput)) return "software";
  if (/\bh264_videotoolbox\b/.test(ffmpegEncodersOutput)) return "gpu";
  throw new Error("This FFmpeg build has neither libx264 nor VideoToolbox H.264 encoding.");
}

export function detectH264EncoderMode(ffmpegPath: string, gpuRequested: boolean): H264EncoderMode {
  const encoders = execFileSync(ffmpegPath, ["-hide_banner", "-encoders"], {
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 5000,
  });
  return resolveH264EncoderMode(encoders, gpuRequested);
}

function chooseBestPathCandidate(
  name: "ffmpeg" | "ffprobe",
  candidates: string[],
): string | undefined {
  const normalized = candidates.map((s) => s.trim()).filter(Boolean);
  if (normalized.length === 0) return undefined;
  const lowerName = name.toLowerCase();
  const preferredExe = normalized.find((candidate) =>
    candidate.toLowerCase().endsWith(`${lowerName}.exe`),
  );
  if (preferredExe) return preferredExe;
  const exact = normalized.find((candidate) => candidate.toLowerCase().endsWith(lowerName));
  if (exact) return exact;
  const nonShellShim = normalized.find((candidate) => {
    const lower = candidate.toLowerCase();
    return !lower.endsWith(".cmd") && !lower.endsWith(".bat");
  });
  return nonShellShim ?? normalized[0];
}

function findOnPath(name: "ffmpeg" | "ffprobe"): string | undefined {
  try {
    const cmd = process.platform === "win32" ? `where ${name}` : `which ${name}`;
    const output = execSync(cmd, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 5000,
    });
    const candidate = chooseBestPathCandidate(name, output.split(/\r?\n/));
    return candidate ? resolve(candidate) : undefined;
  } catch {
    return undefined;
  }
}

// GUI/Dock/launchd-spawned processes on macOS don't inherit the shell PATH, so
// `which ffmpeg` fails even when ffmpeg is installed via Homebrew. Probe the
// well-known install dirs as a fallback. (No-op on Windows, where `where` and
// installer-added PATH entries cover it.)
const COMMON_BIN_DIRS =
  process.platform === "win32"
    ? []
    : ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/snap/bin"];

function findInCommonDirs(name: "ffmpeg" | "ffprobe"): string | undefined {
  for (const dir of COMMON_BIN_DIRS) {
    const candidate = `${dir}/${name}`;
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

function findConfiguredBinary(
  envName: string,
  binaryName: "ffmpeg" | "ffprobe",
): string | undefined {
  const configured = process.env[envName]?.trim();
  if (configured) return existsSync(configured) ? resolve(configured) : undefined;
  return findOnPath(binaryName) ?? findInCommonDirs(binaryName);
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
    case "linux": {
      // Distro-aware so WSL/Fedora/Arch/Alpine users get a command that
      // actually works instead of a Debian-only `apt` line.
      const distro = detectLinuxDistro();
      return ffmpegInstallCommand(distro.family);
    }
    case "win32":
      return "Download the 64-bit Windows build from https://ffmpeg.org/download.html#build-windows and add its bin/ directory to PATH.";
    default:
      return "https://ffmpeg.org/download.html";
  }
}
