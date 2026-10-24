const RENDER_SETTINGS_KEY = "hf-studio-render-settings";

export type StudioRenderFormat = "mp4" | "webm" | "mov" | "png-sequence";
const STUDIO_RENDER_FORMATS: readonly StudioRenderFormat[] = ["mp4", "webm", "mov", "png-sequence"];

export function isStudioRenderFormat(value: unknown): value is StudioRenderFormat {
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
