import { execSync } from "node:child_process";

export function findFFmpeg(): string | undefined {
  try {
    const result = execSync("which ffmpeg", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 5000,
    }).trim();
    return result || undefined;
  } catch {
    return undefined;
  }
}

export function getFFmpegInstallHint(): string {
  switch (process.platform) {
    case "darwin":
      return "brew install ffmpeg";
    case "linux":
      return "sudo apt install ffmpeg";
    default:
      return "https://ffmpeg.org/download.html";
  }
}
