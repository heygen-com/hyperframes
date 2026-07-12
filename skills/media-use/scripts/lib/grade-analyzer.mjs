import { execFileSync } from "node:child_process";
import { basename, extname } from "node:path";

const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".tif", ".tiff"]);
const SAMPLE_FRAMES = 5;
// A long HD clip on slow storage can exceed the default 15s signalstats window;
// override without a code change via HYPERFRAMES_ANALYZE_TIMEOUT_MS.
const SIGNALSTATS_TIMEOUT_MS = Number(process.env.HYPERFRAMES_ANALYZE_TIMEOUT_MS) || 15000;

const ADJUST_LIMITS = {
  exposure: { min: -2, max: 2 },
  contrast: { min: -1, max: 1 },
  highlights: { min: -1, max: 1 },
  shadows: { min: -1, max: 1 },
  whites: { min: -1, max: 1 },
  blacks: { min: -1, max: 1 },
  temperature: { min: -1, max: 1 },
  tint: { min: -1, max: 1 },
  vibrance: { min: -1, max: 1 },
  saturation: { min: -1, max: 1 },
};

function clamp(value, key) {
  const limit = ADJUST_LIMITS[key];
  if (!Number.isFinite(value)) return 0;
  return Math.min(limit.max, Math.max(limit.min, value));
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}

function avg(values) {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function probeDuration(mediaPath) {
  try {
    const raw = execFileSync(
      "ffprobe",
      ["-v", "quiet", "-print_format", "json", "-show_format", mediaPath],
      { encoding: "utf8", timeout: 5000 },
    );
    const parsed = JSON.parse(raw);
    const duration = Number(parsed.format?.duration);
    return Number.isFinite(duration) && duration > 0 ? duration : null;
  } catch {
    return null;
  }
}

function filterFor(mediaPath) {
  const ext = extname(mediaPath).toLowerCase();
  if (IMAGE_EXT.has(ext)) return "signalstats,metadata=print:file=-";
  const duration = probeDuration(mediaPath);
  if (!duration || duration <= 1) return "signalstats,metadata=print:file=-";
  const fps = Math.max(0.1, Math.min(2, SAMPLE_FRAMES / duration));
  return `fps=${fps.toFixed(4)},signalstats,metadata=print:file=-`;
}

function parseSignalStats(raw) {
  const frames = [];
  let current = null;
  for (const line of String(raw).split(/\r?\n/)) {
    const frameMatch = line.match(/^frame:/);
    if (frameMatch) {
      if (current) frames.push(current);
      current = {};
      continue;
    }
    const match = line.match(/lavfi\.signalstats\.([A-Z]+)=([+-]?(?:\d+(?:\.\d+)?|\.\d+))/);
    if (!match) continue;
    if (!current) current = {};
    current[match[1]] = Number(match[2]);
  }
  if (current) frames.push(current);
  const complete = frames.filter(
    (frame) =>
      Number.isFinite(frame.YMIN) &&
      Number.isFinite(frame.YMAX) &&
      Number.isFinite(frame.YAVG) &&
      Number.isFinite(frame.UAVG) &&
      Number.isFinite(frame.VAVG),
  );
  if (complete.length === 0) {
    throw new Error("no signalstats frames found");
  }
  return {
    frames: complete.length,
    yMin: Math.min(...complete.map((frame) => frame.YMIN)),
    yMax: Math.max(...complete.map((frame) => frame.YMAX)),
    yAvg: avg(complete.map((frame) => frame.YAVG)),
    uAvg: avg(complete.map((frame) => frame.UAVG)),
    vAvg: avg(complete.map((frame) => frame.VAVG)),
  };
}

export function statsToAdjust(stats) {
  const yMin = Number(stats.yMin);
  const yMax = Number(stats.yMax);
  const yAvg = Number(stats.yAvg);
  const uAvg = Number(stats.uAvg);
  const vAvg = Number(stats.vAvg);
  const spread = (yMax - yMin) / 255;
  const normalizedAvg = yAvg / 255;
  const exposure = clamp((0.45 - normalizedAvg) * 1.8, "exposure");
  const contrast = clamp((0.42 - spread) * 0.9, "contrast");
  const whites =
    yMax > 230 ? clamp(-((yMax - 230) / 40 + Math.max(0, normalizedAvg - 0.74)), "whites") : 0;
  const blacks = yMin < 12 ? clamp((12 - yMin) / 80, "blacks") : 0;
  const chromaWarmth = (vAvg - 128 + (128 - uAvg)) / 128;
  const temperature = clamp(-chromaWarmth * 0.7, "temperature");
  const tint = clamp(-(uAvg - 128 + (vAvg - 128)) / 256, "tint");

  return {
    adjust: {
      exposure: round(exposure),
      contrast: round(contrast),
      blacks: round(blacks),
      whites: round(whites),
      temperature: round(temperature),
      tint: round(tint),
    },
    measured: {
      frames: Number(stats.frames ?? 1),
      yMin: round(yMin),
      yMax: round(yMax),
      yAvg: round(yAvg),
      uAvg: round(uAvg),
      vAvg: round(vAvg),
    },
  };
}

export function analyzeMediaGrade(mediaPath) {
  try {
    const raw = execFileSync(
      "ffmpeg",
      [
        "-hide_banner",
        "-nostdin",
        "-v",
        "error",
        "-i",
        mediaPath,
        "-vf",
        filterFor(mediaPath),
        "-frames:v",
        String(SAMPLE_FRAMES),
        "-f",
        "null",
        "-",
      ],
      { encoding: "utf8", timeout: SIGNALSTATS_TIMEOUT_MS, stdio: ["ignore", "pipe", "pipe"] },
    );
    return statsToAdjust(parseSignalStats(raw));
  } catch (err) {
    throw new Error(`grade analysis failed for ${mediaPath}: ${err.message}`);
  }
}

export function formatMeasuredNote(mediaPath, measured) {
  return `media-use: measured ${basename(mediaPath)}: frames=${measured.frames}, YMIN=${measured.yMin}, YMAX=${measured.yMax}, YAVG=${measured.yAvg}, UAVG=${measured.uAvg}, VAVG=${measured.vAvg}; adjust is a starting suggestion`;
}
