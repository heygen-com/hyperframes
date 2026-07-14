import { findFfBinary } from "@hyperframes/parsers/ff-binaries";
import { detectLinuxDistro, ffmpegInstallCommand } from "./linuxDeps.js";

export { FFMPEG_PATH_ENV, FFPROBE_PATH_ENV } from "@hyperframes/parsers/ff-binaries";

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
