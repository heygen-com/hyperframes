/**
 * GPU Encoder Detection
 *
 * Shared GPU encoder detection and naming utilities used by both
 * chunkEncoder and streamingEncoder services.
 */

import { spawn } from "child_process";

export type GpuEncoder = "nvenc" | "videotoolbox" | "vaapi" | "qsv" | null;

export async function detectGpuEncoder(): Promise<GpuEncoder> {
  return new Promise((resolve) => {
    const ffmpeg = spawn("ffmpeg", ["-encoders"], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";

    ffmpeg.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    ffmpeg.on("close", () => {
      if (stdout.includes("h264_nvenc")) resolve("nvenc");
      else if (stdout.includes("h264_videotoolbox")) resolve("videotoolbox");
      else if (stdout.includes("h264_vaapi")) resolve("vaapi");
      else if (stdout.includes("h264_qsv")) resolve("qsv");
      else resolve(null);
    });

    ffmpeg.on("error", () => resolve(null));
  });
}

let cachedGpuEncoder: GpuEncoder | undefined = undefined;

export async function getCachedGpuEncoder(): Promise<GpuEncoder> {
  if (cachedGpuEncoder === undefined) {
    cachedGpuEncoder = await detectGpuEncoder();
  }
  return cachedGpuEncoder;
}

export function getGpuEncoderName(encoder: GpuEncoder, codec: "h264" | "h265"): string {
  if (!encoder) return codec === "h264" ? "libx264" : "libx265";
  switch (encoder) {
    case "nvenc":
      return codec === "h264" ? "h264_nvenc" : "hevc_nvenc";
    case "videotoolbox":
      return codec === "h264" ? "h264_videotoolbox" : "hevc_videotoolbox";
    case "vaapi":
      return codec === "h264" ? "h264_vaapi" : "hevc_vaapi";
    case "qsv":
      return codec === "h264" ? "h264_qsv" : "hevc_qsv";
    default:
      return codec === "h264" ? "libx264" : "libx265";
  }
}
