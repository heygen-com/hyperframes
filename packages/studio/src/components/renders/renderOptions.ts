import {
  normalizeRenderSettings,
  validateRateControl,
  type AdvancedRenderSettings,
  type RenderSettings,
} from "./renderSettings";

export type RenderSettingsOverrides = Partial<Omit<RenderSettings, "fps">> & { fps?: number };
type ResolvedRenderOptions = Omit<RenderSettings, "fps"> & { fps: number };
type Resolved = { ok: true; settings: ResolvedRenderOptions } | { ok: false; error: string };

export function resolveRenderOptions(
  saved: RenderSettings,
  options: RenderSettingsOverrides,
): Resolved {
  const format = options.format ?? saved.format;
  if (options.rateControl !== undefined) {
    const error = validateRateControl(options.rateControl, format);
    if (error) return { ok: false, error };
  }
  const videoFrameFormat = options.videoFrameFormat ?? saved.videoFrameFormat;
  const hdrMode = options.hdrMode ?? saved.hdrMode;
  if (!["auto", "jpg", "png"].includes(videoFrameFormat))
    return { ok: false, error: "Source video frames must be Auto, JPG or PNG." };
  if (!["auto", "force-hdr", "force-sdr"].includes(hdrMode))
    return { ok: false, error: "Choose a valid HDR mode." };
  const settings = normalizeRenderSettings({
    format,
    quality: options.quality ?? saved.quality,
    fps: saved.fps,
    gpu: options.gpu ?? saved.gpu,
    rateControl: options.rateControl ?? saved.rateControl,
    videoFrameFormat,
    hdrMode,
  });
  return { ok: true, settings: { ...settings, fps: options.fps ?? saved.fps } };
}

export interface EncoderOptionsBody {
  crf?: number;
  videoBitrate?: string;
  videoFrameFormat?: "jpg" | "png";
  hdrMode?: "force-hdr" | "force-sdr";
}

export function serializeEncoderOptions(
  settings: AdvancedRenderSettings & { format: RenderSettings["format"] },
): EncoderOptionsBody {
  const body: EncoderOptionsBody = {};
  if (settings.format !== "mov" && settings.format !== "gif") {
    if (settings.rateControl.mode === "crf") body.crf = settings.rateControl.value;
    if (settings.rateControl.mode === "bitrate") body.videoBitrate = settings.rateControl.value;
  }
  if (settings.videoFrameFormat !== "auto") body.videoFrameFormat = settings.videoFrameFormat;
  if (settings.hdrMode !== "auto") body.hdrMode = settings.hdrMode;
  return body;
}
