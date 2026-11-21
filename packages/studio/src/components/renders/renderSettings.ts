import type { SelectOption } from "../ui/Select";
import type { StartRenderHandler } from "./RenderQueue";
import type { ResolutionPreset } from "./useRenderQueue";

const RENDER_SETTINGS_KEY = "hf-studio-render-settings";
const VIDEO_BITRATE = /^\d+(\.\d+)?[kKmMgG]?$/;

export type RateControl =
  | { mode: "auto" }
  | { mode: "crf"; value: number }
  | { mode: "bitrate"; value: string };

export interface AdvancedRenderSettings {
  rateControl: RateControl;
  videoFrameFormat: "auto" | "jpg" | "png";
  hdrMode: "auto" | "force-hdr" | "force-sdr";
}

// Optional additions keep host applications' existing settings objects valid.
export interface PersistedRenderSettings extends Partial<AdvancedRenderSettings> {
  format: "mp4" | "webm" | "mov" | "gif";
  quality: "draft" | "standard" | "high";
  fps: 24 | 30 | 60;
  gpu: boolean;
}

export type RenderSettings = PersistedRenderSettings & AdvancedRenderSettings;

export function getDefaultRenderSettings(): RenderSettings {
  return {
    format: "mp4",
    quality: "standard",
    fps: 30,
    gpu: false,
    rateControl: { mode: "auto" },
    videoFrameFormat: "auto",
    hdrMode: "auto",
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === "string" && allowed.some((item) => item === value);
}

export function validateRateControl(
  rate: RateControl,
  format: RenderSettings["format"],
): string | null {
  if (format === "mov" || format === "gif") return null;
  if (!isRecord(rate)) return "Choose a valid rate control mode.";
  if (rate.mode === "auto") return null;
  if (rate.mode === "crf") {
    const max = format === "webm" ? 63 : 51;
    return typeof rate.value === "number" &&
      Number.isInteger(rate.value) &&
      rate.value >= 0 &&
      rate.value <= max
      ? null
      : `CRF must be an integer from 0 to ${max} for ${format.toUpperCase()}.`;
  }
  if (rate.mode === "bitrate" && typeof rate.value === "string") {
    const value = rate.value.trim();
    return value === "" || VIDEO_BITRATE.test(value)
      ? null
      : 'Video bitrate must look like "10M", "2500k" or "8000000".';
  }
  return "Choose a valid rate control mode.";
}

export function normalizeRenderSettings(settings: RenderSettings): RenderSettings {
  let rateControl = settings.rateControl;
  if (
    settings.format === "mov" ||
    settings.format === "gif" ||
    validateRateControl(rateControl, settings.format)
  ) {
    rateControl = { mode: "auto" };
  } else if (rateControl.mode === "bitrate") {
    const value = rateControl.value.trim();
    rateControl = value ? { mode: "bitrate", value } : { mode: "auto" };
  }
  return { ...settings, rateControl };
}

function readRateControl(value: unknown): RateControl {
  if (!isRecord(value)) return { mode: "auto" };
  if (value.mode === "crf" && typeof value.value === "number")
    return { mode: "crf", value: value.value };
  if (value.mode === "bitrate" && typeof value.value === "string")
    return { mode: "bitrate", value: value.value };
  return { mode: "auto" };
}

export function getRenderSettings(): RenderSettings {
  const settings = getDefaultRenderSettings();
  try {
    const raw = localStorage.getItem(RENDER_SETTINGS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!isRecord(parsed)) return settings;
    return normalizeRenderSettings({
      format: oneOf(parsed.format, ["mp4", "webm", "mov", "gif"]) ? parsed.format : settings.format,
      quality: oneOf(parsed.quality, ["draft", "standard", "high"])
        ? parsed.quality
        : settings.quality,
      fps: parsed.fps === 24 || parsed.fps === 30 || parsed.fps === 60 ? parsed.fps : settings.fps,
      gpu: parsed.gpu === true,
      rateControl: readRateControl(parsed.rateControl),
      videoFrameFormat: oneOf(parsed.videoFrameFormat, ["auto", "jpg", "png"])
        ? parsed.videoFrameFormat
        : "auto",
      hdrMode: oneOf(parsed.hdrMode, ["auto", "force-hdr", "force-sdr"]) ? parsed.hdrMode : "auto",
    });
  } catch {
    return settings;
  }
}

function compactSettings(settings: RenderSettings): PersistedRenderSettings {
  const result: PersistedRenderSettings = {
    format: settings.format,
    quality: settings.quality,
    fps: settings.fps,
    gpu: settings.gpu,
  };
  if (settings.rateControl.mode !== "auto") result.rateControl = settings.rateControl;
  if (settings.videoFrameFormat !== "auto") result.videoFrameFormat = settings.videoFrameFormat;
  if (settings.hdrMode !== "auto") result.hdrMode = settings.hdrMode;
  return result;
}

export function getPersistedRenderSettings(): PersistedRenderSettings {
  return compactSettings(getRenderSettings());
}

export function updatePersistedRenderSettings(patch: Partial<RenderSettings>): RenderSettings {
  const saved = getRenderSettings();
  const settings = normalizeRenderSettings({
    format: patch.format ?? saved.format,
    quality: patch.quality ?? saved.quality,
    fps: patch.fps ?? saved.fps,
    gpu: patch.gpu ?? saved.gpu,
    rateControl: patch.rateControl ?? saved.rateControl,
    videoFrameFormat: patch.videoFrameFormat ?? saved.videoFrameFormat,
    hdrMode: patch.hdrMode ?? saved.hdrMode,
  });
  try {
    localStorage.setItem(RENDER_SETTINGS_KEY, JSON.stringify(compactSettings(settings)));
  } catch {
    /* Export can still use the current form when storage is unavailable. */
  }
  return settings;
}

export function persistRenderSettings(
  format: PersistedRenderSettings["format"],
  quality: PersistedRenderSettings["quality"],
  fps: PersistedRenderSettings["fps"],
  gpu?: boolean,
): void {
  updatePersistedRenderSettings({ format, quality, fps, gpu });
}

export function resolveRenderFormat(value: string): PersistedRenderSettings["format"] {
  return (["mp4", "webm", "mov", "gif"] as const).find((format) => format === value) ?? "mp4";
}

export function startConfiguredRender(
  onStartRender: StartRenderHandler,
  settings: PersistedRenderSettings & { resolution: ResolutionPreset | "auto"; gifLoop: number },
): void | Promise<void> {
  const { format, quality, resolution, fps, gpu, gifLoop } = settings;
  if (format === "gif") return onStartRender(format, quality, resolution, fps, false, gifLoop);
  const rateControl = settings.rateControl ?? { mode: "auto" };
  const videoFrameFormat = settings.videoFrameFormat ?? "auto";
  const hdrMode = settings.hdrMode ?? "auto";
  if (rateControl.mode === "auto" && videoFrameFormat === "auto" && hdrMode === "auto") {
    return onStartRender(format, quality, resolution, fps, gpu);
  }
  return onStartRender(format, quality, resolution, fps, gpu, undefined, {
    rateControl,
    videoFrameFormat,
    hdrMode,
  });
}

export function isRenderExportBlocked(
  isRendering: boolean,
  missingFfmpeg: boolean,
  invalidGifLoop: boolean,
  invalidAdvancedDraft = false,
): boolean {
  return isRendering || missingFfmpeg || invalidGifLoop || invalidAdvancedDraft;
}

export const FORMAT_INFO: Record<"mp4" | "webm" | "mov" | "gif", { label: string; desc: string }> =
  {
    gif: { label: "GIF", desc: "Animated image for docs and chat. No audio; up to 30 fps." },
    mp4: { label: "MP4", desc: "Best for general use. Smallest file, universal playback." },
    mov: {
      label: "MOV (ProRes 4444)",
      desc: "Transparent video. Works in Final Cut Pro, DaVinci Resolve, and most video editors. Large files.",
    },
    webm: {
      label: "WebM (VP9)",
      desc: "Transparent video for web. Smaller than MOV but limited editor support.",
    },
  };

const FPS_OPTIONS: SelectOption[] = [
  { value: "24", label: "24 fps" },
  { value: "30", label: "30 fps" },
  { value: "60", label: "60 fps" },
];

export function resolveRenderFps(
  format: PersistedRenderSettings["format"],
  fps: PersistedRenderSettings["fps"],
): PersistedRenderSettings["fps"] {
  return format === "gif" && fps === 60 ? 30 : fps;
}

export function getRenderFpsOptions(format: PersistedRenderSettings["format"]): SelectOption[] {
  return FPS_OPTIONS.map((option) => ({
    ...option,
    disabled: format === "gif" && option.value === "60",
  }));
}
