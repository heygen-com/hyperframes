import { createJsonStore } from "../../utils/jsonStore";

const RENDER_SETTINGS_KEY = "hf-studio-render-settings";

export interface PersistedRenderSettings {
  format: "mp4" | "webm" | "mov";
  quality: "draft" | "standard" | "high";
  fps: 24 | 30 | 60;
}

const DEFAULTS: PersistedRenderSettings = { format: "mp4", quality: "standard", fps: 30 };

/** Each field falls back on its own: a stale format should not reset the fps. */
function parseRenderSettings(raw: unknown): PersistedRenderSettings {
  const value = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const pick = <K extends keyof PersistedRenderSettings>(
    field: K,
    allowed: ReadonlyArray<PersistedRenderSettings[K]>,
  ): PersistedRenderSettings[K] =>
    allowed.includes(value[field] as PersistedRenderSettings[K])
      ? (value[field] as PersistedRenderSettings[K])
      : DEFAULTS[field];

  return {
    format: pick("format", ["mp4", "webm", "mov"]),
    quality: pick("quality", ["draft", "standard", "high"]),
    fps: pick("fps", [24, 30, 60]),
  };
}

const store = createJsonStore<PersistedRenderSettings>({
  key: RENDER_SETTINGS_KEY,
  fallback: DEFAULTS,
  parse: parseRenderSettings,
});

export function getPersistedRenderSettings(): PersistedRenderSettings {
  return store.read();
}

export function persistRenderSettings(
  format: PersistedRenderSettings["format"],
  quality: PersistedRenderSettings["quality"],
  fps: PersistedRenderSettings["fps"],
): void {
  store.write({ format, quality, fps });
}
