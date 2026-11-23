import { getCachedGpuEncoder } from "@hyperframes/engine";
import { findFfBinary, getSkippedX86Binary } from "@hyperframes/parsers/ff-binaries";
import { detectLinuxDistro, ffmpegInstallCommand } from "./linuxDeps.js";
import { runCancellableProcess } from "../utils/cancellableProcess.js";

export { FFMPEG_PATH_ENV, FFPROBE_PATH_ENV } from "@hyperframes/parsers/ff-binaries";

export type H264EncoderMode = "software" | "gpu";

export class H264EncoderUnavailableError extends Error {
  constructor(
    readonly hevcEncoderAvailable = false,
    ffmpegPath?: string,
  ) {
    super(
      `${ffmpegPath ?? "This FFmpeg build"} has no libx264 and no GPU H.264 encoder that works on this machine.`,
    );
    this.name = "H264EncoderUnavailableError";
  }
}

/**
 * Select the H.264 encoder class supported by an FFmpeg build.
 *
 * Some FFmpeg distributions omit libx264. Without a GPU encoder that passes
 * the engine's probe, the encoder falls back to libx264-only options such as
 * `-preset`, so those builds must be refused before capture.
 */
export function resolveH264EncoderMode(
  ffmpegEncodersOutput: string,
  gpuRequested: boolean,
  usableGpu: boolean,
  ffmpegPath?: string,
): H264EncoderMode {
  if (gpuRequested && usableGpu) return "gpu";
  if (hasLibx264(ffmpegEncodersOutput)) return "software";
  if (usableGpu) return "gpu";
  throw new H264EncoderUnavailableError(/\blibx265\b/.test(ffmpegEncodersOutput), ffmpegPath);
}

function hasLibx264(ffmpegEncodersOutput: string): boolean {
  return /\blibx264\b/.test(ffmpegEncodersOutput);
}

export async function detectH264EncoderModeForRender(
  ffmpegPath: string,
  gpuRequested: boolean,
  signal: AbortSignal,
  probeGpu: () => Promise<unknown> = getCachedGpuEncoder,
): Promise<H264EncoderMode> {
  const result = await runCancellableProcess(ffmpegPath, ["-hide_banner", "-encoders"], {
    signal,
    timeoutMs: FIRST_LAUNCH_TIMEOUT_MS,
  });
  const needsGpu = gpuRequested || !hasLibx264(result.stdout);
  const usableGpu = needsGpu && (await probeGpu()) !== null;
  return resolveH264EncoderMode(result.stdout, gpuRequested, usableGpu, ffmpegPath);
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

export const FIRST_LAUNCH_TIMEOUT_MS = 60_000;
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
  const ignored = (["ffmpeg", "ffprobe"] as const)
    .filter((name) => !findFfBinary(name, { configuredMustExist: true }))
    .map(getSkippedX86Binary)
    .filter((path) => path !== undefined);
  const note = ignored.map((path) => ` (ignored ${path}: x86_64 only, it cannot run on this Mac)`);
  return installHint() + note.join("");
}

function installHint(): string {
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
