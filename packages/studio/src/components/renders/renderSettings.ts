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
  format: "mp4" | "webm" | "mov";
  quality: "draft" | "standard" | "high";
  fps: 24 | 30 | 60;
  gpu: boolean;
}

export type RenderSettings = PersistedRenderSettings & AdvancedRenderSettings;

function defaults(): RenderSettings {
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
  if (format === "mov") return null;
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
  if (settings.format === "mov" || validateRateControl(rateControl, settings.format)) {
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
  const settings = defaults();
  try {
    const raw = localStorage.getItem(RENDER_SETTINGS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!isRecord(parsed)) return settings;
    return normalizeRenderSettings({
      format: oneOf(parsed.format, ["mp4", "webm", "mov"]) ? parsed.format : settings.format,
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
