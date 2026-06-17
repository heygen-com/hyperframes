// fallow-ignore-file complexity
/**
 * GPU Encoder Detection
 *
 * Shared GPU encoder detection and naming utilities used by both
 * chunkEncoder and streamingEncoder services.
 */

import { spawn } from "child_process";
import { getFfmpegBinary } from "./ffmpegBinaries.js";

export type ConcreteGpuEncoder = "nvenc" | "videotoolbox" | "vaapi" | "qsv" | "amf";
export type GpuEncoder = ConcreteGpuEncoder | null;

const GPU_ENCODER_CANDIDATES: ConcreteGpuEncoder[] = [
  "nvenc",
  "videotoolbox",
  "vaapi",
  "qsv",
  "amf",
];

const H264_ENCODER_BY_GPU: Record<ConcreteGpuEncoder, string> = {
  nvenc: "h264_nvenc",
  videotoolbox: "h264_videotoolbox",
  vaapi: "h264_vaapi",
  qsv: "h264_qsv",
  amf: "h264_amf",
};

const GPU_PROBE_TIMEOUT_MS = 2000;
const GPU_PROBE_KILL_GRACE_MS = 1000;

export function getCompiledGpuEncoders(ffmpegEncodersStdout: string): ConcreteGpuEncoder[] {
  return GPU_ENCODER_CANDIDATES.filter((encoder) =>
    ffmpegEncodersStdout.includes(H264_ENCODER_BY_GPU[encoder]),
  );
}

export async function selectUsableGpuEncoder(
  candidates: readonly ConcreteGpuEncoder[],
  isUsable: (encoder: ConcreteGpuEncoder) => Promise<boolean>,
): Promise<GpuEncoder> {
  const results = await Promise.all(
    candidates.map(async (encoder) => {
      try {
        return { encoder, usable: await isUsable(encoder) };
      } catch {
        return { encoder, usable: false };
      }
    }),
  );

  for (const result of results) {
    if (result.usable) {
      return result.encoder;
    }
  }
  return null;
}

export async function detectGpuEncoder(): Promise<GpuEncoder> {
  return new Promise((resolve) => {
    const ffmpeg = spawn(getFfmpegBinary(), ["-encoders"], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";

    ffmpeg.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    ffmpeg.on("close", () => {
      const candidates = getCompiledGpuEncoders(stdout);
      void selectUsableGpuEncoder(candidates, canUseGpuEncoder)
        .then(resolve)
        .catch(() => resolve(null));
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
    case "amf":
      return codec === "h264" ? "h264_amf" : "hevc_amf";
    default:
      return codec === "h264" ? "libx264" : "libx265";
  }
}

// Minimum probe dimensions must clear every GPU encoder's hardware minimum.
// NVIDIA data-center SKUs (L4/T4/A10/A100) reject frames below ~257px on
// either dimension with "Frame Dimension less than the minimum supported
// value" (observed on driver 595.58.03, CUDA 13.2). The documented SDK
// minimums (145×49 H.264, 129×33 HEVC) are lower, but the driver enforces
// a stricter per-SKU alignment. 320×240 clears all known GPU encoder
// minimums (NVENC, VideoToolbox, VAAPI, QSV, AMF) while staying cheap.
const GPU_PROBE_WIDTH = 320;
const GPU_PROBE_HEIGHT = 240;

export function getProbeArgs(encoder: ConcreteGpuEncoder): string[] {
  const args = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    `color=size=${GPU_PROBE_WIDTH}x${GPU_PROBE_HEIGHT}:rate=1:duration=1`,
    "-frames:v",
    "1",
    "-an",
  ];

  if (encoder === "vaapi") {
    args.push("-vaapi_device", "/dev/dri/renderD128", "-vf", "format=nv12,hwupload");
  }

  args.push("-c:v", getGpuEncoderName(encoder, "h264"));

  if (encoder === "amf") {
    args.push("-rc", "cqp", "-qp_i", "28", "-qp_p", "28");
  }

  args.push("-f", "null", "-");
  return args;
}

async function canUseGpuEncoder(encoder: ConcreteGpuEncoder): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    let timedOut = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    let stderr = "";
    const finish = (usable: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      resolve(usable);
    };
    const ffmpeg = spawn(getFfmpegBinary(), getProbeArgs(encoder), {
      stdio: ["ignore", "ignore", "pipe"],
    });

    ffmpeg.stderr?.on("data", (data) => {
      stderr += data.toString();
    });

    const timer = setTimeout(() => {
      timedOut = true;
      ffmpeg.kill("SIGTERM");
      killTimer = setTimeout(() => {
        ffmpeg.kill("SIGKILL");
        finish(false);
      }, GPU_PROBE_KILL_GRACE_MS);
    }, GPU_PROBE_TIMEOUT_MS);

    ffmpeg.on("close", (code, signal) => {
      const usable = code === 0;
      logGpuProbeFailure(encoder, { code, signal, stderr, timedOut });
      finish(usable);
    });

    ffmpeg.on("error", (error) => {
      logGpuProbeFailure(encoder, { error, timedOut });
      finish(false);
    });
  });
}

function logGpuProbeFailure(
  encoder: ConcreteGpuEncoder,
  result: {
    code?: number | null;
    error?: Error;
    signal?: NodeJS.Signals | null;
    stderr?: string;
    timedOut?: boolean;
  },
): void {
  if (!isGpuProbeDebugEnabled()) return;
  if (result.code === 0 && !result.error && !result.timedOut) return;

  const reason = result.error
    ? result.error.message
    : result.timedOut
      ? `timed out after ${GPU_PROBE_TIMEOUT_MS}ms`
      : `exit=${String(result.code)} signal=${String(result.signal ?? "")}`;
  const stderr = result.stderr?.trim();
  console.warn(`[gpuEncoder] ${encoder} probe failed: ${reason}${stderr ? `\n${stderr}` : ""}`);
}

function isGpuProbeDebugEnabled(): boolean {
  const value = process.env.HYPERFRAMES_DEBUG_GPU_PROBE;
  return value === "1" || value === "true";
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
 * - `videotoolbox`, `vaapi`, `amf`, `null`: no remap (they either ignore
 *   `-preset` entirely or accept the libx264 vocabulary).
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
