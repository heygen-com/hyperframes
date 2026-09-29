// Vendored plain-JS copy of packages/core/src/mediaGradeAnalyzer.ts.
// packages/core/src/mediaGradeAnalyzer.vendoredParity.test.ts guards behavior drift.
import { execFileSync } from "node:child_process";
import { basename, extname } from "node:path";

const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".tif", ".tiff"]);
const SAMPLE_FRAMES = 5;
const DEFAULT_TIMEOUT_MS = 15_000;

const ADJUST_LIMITS = {
  exposure: { min: -2, max: 2 },
  contrast: { min: -1, max: 1 },
  whites: { min: -1, max: 1 },
  blacks: { min: -1, max: 1 },
  temperature: { min: -1, max: 1 },
  tint: { min: -1, max: 1 },
};

function clamp(value, key) {
  const limit = ADJUST_LIMITS[key];
  if (!Number.isFinite(value)) return 0;
  return Math.min(limit.max, Math.max(limit.min, value));
}

function round(value) {
  const rounded = Math.round(value * 1000) / 1000;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function average(values) {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}

function probeMedia(mediaPath, ffprobePath) {
  try {
    const raw = execFileSync(
      ffprobePath,
      [
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=color_space,color_transfer,color_primaries,pix_fmt,duration:format=duration",
        "-of",
        "json",
        "--",
        mediaPath,
      ],
      { encoding: "utf8", timeout: 5_000, stdio: ["ignore", "pipe", "pipe"] },
    );
    const parsed = JSON.parse(raw);
    const stream = Array.isArray(parsed.streams) ? (parsed.streams[0] ?? {}) : {};
    const duration = Number(stream.duration ?? parsed.format?.duration);
    const text = (key) =>
      typeof stream[key] === "string" && stream[key] ? stream[key] : "unknown";
    return {
      duration: Number.isFinite(duration) && duration > 0 ? duration : null,
      colorSpace: text("color_space"),
      transfer: text("color_transfer"),
      primaries: text("color_primaries"),
      pixelFormat: text("pix_fmt"),
    };
  } catch {
    return {
      duration: null,
      colorSpace: "unknown",
      transfer: "unknown",
      primaries: "unknown",
      pixelFormat: "unknown",
    };
  }
}

export function parseMediaTreatmentSignalStats(raw) {
  const frames = [];
  let current = null;
  for (const line of String(raw).split(/\r?\n/)) {
    // One digit is enough: .* consumes the rest without overlapping repetitions.
    const frame = line.match(/^frame:\d.*pts_time:([+-]?(?:\d+(?:\.\d+)?|\.\d+))/);
    if (frame) {
      if (current) frames.push(current);
      current = { ptsTime: Number(frame[1]) };
      continue;
    }
    const stat = line.match(/lavfi\.signalstats\.([A-Z]+)=([+-]?(?:\d+(?:\.\d+)?|\.\d+))/);
    if (!stat) continue;
    current ??= {};
    current[stat[1]] = Number(stat[2]);
  }
  if (current) frames.push(current);
  return frames.filter(
    (frame) =>
      Number.isFinite(frame.YMIN) &&
      Number.isFinite(frame.YLOW) &&
      Number.isFinite(frame.YAVG) &&
      Number.isFinite(frame.YHIGH) &&
      Number.isFinite(frame.YMAX) &&
      Number.isFinite(frame.UAVG) &&
      Number.isFinite(frame.VAVG),
  );
}

function summarizeFrames(frames) {
  if (frames.length === 0) throw new Error("FFmpeg returned no analyzable video frames");
  return {
    frames: frames.length,
    yMin: Math.min(...frames.map((frame) => frame.YMIN)),
    yLow: average(frames.map((frame) => frame.YLOW)),
    yAvg: average(frames.map((frame) => frame.YAVG)),
    yHigh: average(frames.map((frame) => frame.YHIGH)),
    yMax: Math.max(...frames.map((frame) => frame.YMAX)),
    uAvg: average(frames.map((frame) => frame.UAVG)),
    vAvg: average(frames.map((frame) => frame.VAVG)),
    satAvg: average(frames.map((frame) => frame.SATAVG ?? 0)),
    shadowClipRisk: average(frames.map((frame) => (frame.YLOW <= 16 ? 1 : 0))),
    highlightClipRisk: average(frames.map((frame) => (frame.YHIGH >= 235 ? 1 : 0))),
  };
}

function suggestedExposure(normalizedAverage, yLow, yHigh) {
  if (normalizedAverage < 0.28 && yHigh / 255 < 0.65) {
    return clamp((0.32 - normalizedAverage) * 1.2, "exposure");
  }
  if (normalizedAverage > 0.72 && yLow / 255 > 0.3) {
    return clamp((0.68 - normalizedAverage) * 1.2, "exposure");
  }
  return 0;
}

function suggestedTemperature(uAverage, vAverage) {
  const chromaWarmth = (vAverage - 128 + (128 - uAverage)) / 128;
  return Math.abs(chromaWarmth) >= 0.08 ? clamp(-chromaWarmth * 0.25, "temperature") : 0;
}

function suggestedTint(uAverage, vAverage) {
  const cast = uAverage + vAverage - 256;
  return Math.abs(cast) >= 10 ? clamp(-cast / 512, "tint") : 0;
}

export function statsToAdjust(stats) {
  const yMin = Number(stats.yMin);
  const yLow = Number(stats.yLow ?? stats.yMin);
  const yMax = Number(stats.yMax);
  const yHigh = Number(stats.yHigh ?? stats.yMax);
  const yAvg = Number(stats.yAvg);
  const uAvg = Number(stats.uAvg);
  const vAvg = Number(stats.vAvg);
  const shadowClipRisk = Number(stats.shadowClipRisk ?? (yLow <= 16 ? 1 : 0));
  const highlightClipRisk = Number(stats.highlightClipRisk ?? (yHigh >= 235 ? 1 : 0));
  const percentileSpread = (yHigh - yLow) / 255;
  const normalizedAverage = yAvg / 255;
  const contrast = percentileSpread < 0.35 ? clamp((0.35 - percentileSpread) * 0.4, "contrast") : 0;

  return {
    adjust: {
      exposure: round(suggestedExposure(normalizedAverage, yLow, yHigh)),
      contrast: round(contrast),
      blacks: round(clamp(shadowClipRisk * 0.08, "blacks")),
      whites: round(clamp(-highlightClipRisk * 0.08, "whites")),
      temperature: round(suggestedTemperature(uAvg, vAvg)),
      tint: round(suggestedTint(uAvg, vAvg)),
    },
    measured: {
      frames: Number(stats.frames ?? 1),
      yMin: round(yMin),
      yLow: round(yLow),
      yAvg: round(yAvg),
      yHigh: round(yHigh),
      yMax: round(yMax),
      uAvg: round(uAvg),
      vAvg: round(vAvg),
      satAvg: round(Number(stats.satAvg ?? 0)),
      shadowClipRisk: round(shadowClipRisk),
      highlightClipRisk: round(highlightClipRisk),
    },
  };
}

export function summarizeMediaTreatmentAnalysis(probe, frames) {
  const result = statsToAdjust(summarizeFrames(frames));
  const hdr = ["smpte2084", "arib-std-b67"].includes(probe.transfer);
  const diagnosis = [];
  if (result.measured.shadowClipRisk > 0) {
    diagnosis.push("sampled frames contain deep or clipped shadows");
  }
  if (result.measured.highlightClipRisk > 0) {
    diagnosis.push("sampled frames contain bright or clipped highlights");
  }
  if (diagnosis.length === 0) diagnosis.push("no obvious technical imbalance in sampled frames");

  const warnings = [];
  if (hdr) warnings.push("HDR transfer detected; the realtime treatment path is SDR/Rec.709.");
  if (probe.colorSpace === "unknown" || probe.transfer === "unknown") {
    warnings.push(
      "Source color metadata is incomplete; camera LOG cannot be identified reliably from container metadata alone.",
    );
  }

  return {
    ...result,
    source: {
      colorSpace: probe.colorSpace,
      transfer: probe.transfer,
      primaries: probe.primaries,
      pixelFormat: probe.pixelFormat,
      hdr,
      log: "unknown",
    },
    diagnosis,
    warnings,
  };
}

export function analyzeMediaGrade(
  mediaPath,
  { ffmpegPath = "ffmpeg", ffprobePath = "ffprobe" } = {},
) {
  try {
    const probe = probeMedia(mediaPath, ffprobePath);
    const isImage = IMAGE_EXT.has(extname(mediaPath).toLowerCase());
    const fps =
      !isImage && probe.duration
        ? Math.max(0.1, Math.min(2, SAMPLE_FRAMES / probe.duration))
        : null;
    const filters = [
      fps ? `fps=${fps.toFixed(4)}` : null,
      "format=yuv444p",
      "signalstats",
      "metadata=print:file=-",
    ]
      .filter(Boolean)
      .join(",");
    const raw = execFileSync(
      ffmpegPath,
      [
        "-hide_banner",
        "-nostdin",
        "-v",
        "error",
        "-i",
        mediaPath,
        "-vf",
        filters,
        "-frames:v",
        String(SAMPLE_FRAMES),
        "-f",
        "null",
        "-",
      ],
      {
        encoding: "utf8",
        timeout: Number(process.env.HYPERFRAMES_ANALYZE_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    return summarizeMediaTreatmentAnalysis(probe, parseMediaTreatmentSignalStats(raw));
  } catch (error) {
    throw new Error(`grade analysis failed for ${mediaPath}: ${error.message}`);
  }
}

export function formatMeasuredNote(mediaPath, measured) {
  return `media-use: measured ${basename(mediaPath)}: frames=${measured.frames}, YMIN=${measured.yMin}, YLOW=${measured.yLow}, YAVG=${measured.yAvg}, YHIGH=${measured.yHigh}, YMAX=${measured.yMax}, UAVG=${measured.uAvg}, VAVG=${measured.vAvg}; adjust is a starting suggestion`;
}
