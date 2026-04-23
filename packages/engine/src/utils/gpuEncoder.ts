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

// libx264 preset names (ultrafast/superfast/.../placebo) mapped to the
// equivalent NVENC p1..p7 preset. NVENC rejects libx264 names with
// AVERROR(EINVAL) ("Error applying encoder options: Invalid argument"),
// which surfaces as a generic "FFmpeg exited with code -22" — so callers
// that share a single `preset` field across CPU and GPU paths (e.g. the
// `draft`/`standard`/`high` quality tiers) must translate before passing
// the value to h264_nvenc / hevc_nvenc.
const NVENC_PRESET_MAP: Record<string, string> = {
  ultrafast: "p1",
  superfast: "p1",
  veryfast: "p2",
  faster: "p3",
  fast: "p4",
  medium: "p4",
  slow: "p5",
  slower: "p6",
  veryslow: "p7",
  placebo: "p7",
};

// QSV accepts most libx264 preset names but rejects `ultrafast`,
// `superfast`, and `placebo`. Map those to the nearest supported values.
const QSV_PRESET_MAP: Record<string, string> = {
  ultrafast: "veryfast",
  superfast: "veryfast",
  placebo: "veryslow",
};

/**
 * Translate a libx264-style `-preset` value to one accepted by the given
 * GPU encoder.
 *
 * - `nvenc`: libx264 names → `p1`..`p7`. Already-native `pN` values pass
 *   through unchanged. Unknown values fall back to `p4` (medium).
 * - `qsv`:  `ultrafast`/`superfast`/`placebo` → nearest supported name;
 *   everything else passes through.
 * - `videotoolbox`, `vaapi`, `null`: no remap (they either ignore `-preset`
 *   entirely or accept the libx264 vocabulary).
 */
export function mapPresetForGpuEncoder(encoder: GpuEncoder, preset: string): string {
  switch (encoder) {
    case "nvenc":
      if (/^p[1-7]$/.test(preset)) return preset;
      return NVENC_PRESET_MAP[preset] ?? "p4";
    case "qsv":
      return QSV_PRESET_MAP[preset] ?? preset;
    default:
      return preset;
  }
}
