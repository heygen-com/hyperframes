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

const FFMPEG_DOWNLOAD_URL = "https://ffmpeg.org/download.html";

/**
 * The one command that installs FFmpeg on this machine, or `undefined` when
 * the platform has no single command worth pasting.
 *
 * Separate from `getFFmpegInstallHint` because Studio renders this behind a
 * copy button, and a copy button over prose ("download the build from ... and
 * add its bin/ directory to PATH") copies something that is not a command.
 * This is the only place that maps a platform to an install command; the hint
 * below is derived from it.
 */
export function getFFmpegInstallCommand(): string | undefined {
  switch (process.platform) {
    case "darwin":
      return "brew install ffmpeg";
    case "linux": {
      // Distro-aware so WSL/Fedora/Arch/Alpine users get a command that
      // actually works instead of a Debian-only `apt` line.
      const distro = detectLinuxDistro();
      if (distro.family === "unknown") return undefined;
      return ffmpegInstallCommand(distro.family);
    }
    // winget ships with Windows 10 1809+ and Windows 11. Machines without it
    // still get the manual download route from the hint below.
    case "win32":
      return "winget install --id Gyan.FFmpeg -e";
    default:
      return undefined;
  }
}

export function getFFmpegInstallHint(): string {
  const command = getFFmpegInstallCommand();
  // Guarding on `command`, not the platform alone: the function above is the
  // sole owner of platform-to-command, so the day win32 stops returning one
  // this would otherwise interpolate "undefined, or download the ...".
  if (command && process.platform === "win32") {
    return `${command}, or download the 64-bit build from ${FFMPEG_DOWNLOAD_URL}#build-windows and add its bin/ directory to PATH.`;
  }
  if (command) return command;
  if (process.platform === "linux") return ffmpegInstallCommand("unknown");
  return FFMPEG_DOWNLOAD_URL;
}
