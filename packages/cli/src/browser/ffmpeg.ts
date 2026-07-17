import { execFileSync } from "node:child_process";
import { findFfBinary } from "@hyperframes/parsers/ff-binaries";
import { detectLinuxDistro, ffmpegInstallCommand } from "./linuxDeps.js";

export { FFMPEG_PATH_ENV, FFPROBE_PATH_ENV } from "@hyperframes/parsers/ff-binaries";

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

// `configuredMustExist`: the CLI surfaces an install hint when a binary is
// missing, so an env override pointing at a nonexistent file reports as
// not-found instead of being handed to spawn.
export function findFFmpeg(): string | undefined {
  return findFfBinary("ffmpeg", { configuredMustExist: true });
}

export function findFFprobe(): string | undefined {
  return findFfBinary("ffprobe", { configuredMustExist: true });
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
