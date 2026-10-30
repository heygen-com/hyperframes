import type { SelectOption } from "../ui/Select";
import type { StartRenderHandler } from "./RenderQueue";
import type { ResolutionPreset } from "./useRenderQueue";

const RENDER_SETTINGS_KEY = "hf-studio-render-settings";

export type StudioRenderFormat = "mp4" | "webm" | "mov" | "gif" | "png-sequence";
const STUDIO_RENDER_FORMATS: readonly StudioRenderFormat[] = [
  "mp4",
  "webm",
  "mov",
  "gif",
  "png-sequence",
];

function isStudioRenderFormat(value: unknown): value is StudioRenderFormat {
  return STUDIO_RENDER_FORMATS.some((format) => format === value);
}

export interface PersistedRenderSettings {
  format: StudioRenderFormat;
  quality: "draft" | "standard" | "high";
  fps: 24 | 30 | 60;
  gpu: boolean;
}

export function getPersistedRenderSettings(): PersistedRenderSettings {
  try {
    const raw = localStorage.getItem(RENDER_SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        format: isStudioRenderFormat(parsed.format) ? parsed.format : "mp4",
        quality: ["draft", "standard", "high"].includes(parsed.quality)
          ? parsed.quality
          : "standard",
        fps: [24, 30, 60].includes(parsed.fps) ? parsed.fps : 30,
        gpu: parsed.gpu === true,
      };
    }
  } catch {
    /* ignore */
  }
  return { format: "mp4", quality: "standard", fps: 30, gpu: false };
}

export function persistRenderSettings(
  format: PersistedRenderSettings["format"],
  quality: PersistedRenderSettings["quality"],
  fps: PersistedRenderSettings["fps"],
  gpu: boolean = getPersistedRenderSettings().gpu,
): void {
  try {
    localStorage.setItem(RENDER_SETTINGS_KEY, JSON.stringify({ format, quality, fps, gpu }));
  } catch {
    /* ignore */
  }
}

export function resolveRenderFormat(value: string): PersistedRenderSettings["format"] {
  return STUDIO_RENDER_FORMATS.find((format) => format === value) ?? "mp4";
}

export function startConfiguredRender(
  onStartRender: StartRenderHandler,
  settings: PersistedRenderSettings & { resolution: ResolutionPreset | "auto"; gifLoop: number },
): void | Promise<void> {
  const { format, quality, resolution, fps, gpu, gifLoop } = settings;
  if (format === "gif") return onStartRender(format, quality, resolution, fps, false, gifLoop);
  return onStartRender(format, quality, resolution, fps, gpu);
}

export function isRenderExportBlocked(
  isRendering: boolean,
  missingFfmpeg: boolean,
  invalidGifLoop: boolean,
): boolean {
  return isRendering || missingFfmpeg || invalidGifLoop;
}

export const FORMAT_INFO: Record<StudioRenderFormat, { label: string; desc: string }> = {
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
  "png-sequence": {
    label: "PNG sequence",
    desc: "One lossless PNG per frame, plus audio. For compositing tools. Downloads as a ZIP.",
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
