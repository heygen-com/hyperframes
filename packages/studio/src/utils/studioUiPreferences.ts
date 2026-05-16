export interface StoredPreviewZoomState {
  zoomPercent: number;
  panX: number;
  panY: number;
}

export interface StudioUiPreferences {
  leftCollapsed?: boolean;
  timelineVisible?: boolean;
  playbackRate?: number;
  audioMuted?: boolean;
  previewZoom?: StoredPreviewZoomState;
}

const STUDIO_UI_PREFERENCES_KEY = "hf-studio-ui-preferences";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getBrowserStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function readStorage(storage: Storage | null): StudioUiPreferences {
  if (!storage) return {};
  try {
    const raw = storage.getItem(STUDIO_UI_PREFERENCES_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return {};

    const preferences: StudioUiPreferences = {};
    if (typeof parsed.leftCollapsed === "boolean") {
      preferences.leftCollapsed = parsed.leftCollapsed;
    }
    if (typeof parsed.timelineVisible === "boolean") {
      preferences.timelineVisible = parsed.timelineVisible;
    }
    if (typeof parsed.playbackRate === "number" && Number.isFinite(parsed.playbackRate)) {
      preferences.playbackRate = parsed.playbackRate;
    }
    if (typeof parsed.audioMuted === "boolean") {
      preferences.audioMuted = parsed.audioMuted;
    }
    if (isRecord(parsed.previewZoom)) {
      const { zoomPercent, panX, panY } = parsed.previewZoom;
      if (
        typeof zoomPercent === "number" &&
        Number.isFinite(zoomPercent) &&
        typeof panX === "number" &&
        Number.isFinite(panX) &&
        typeof panY === "number" &&
        Number.isFinite(panY)
      ) {
        preferences.previewZoom = { zoomPercent, panX, panY };
      }
    }
    return preferences;
  } catch {
    return {};
  }
}

export function readStudioUiPreferences(storage: Storage | null = getBrowserStorage()) {
  return readStorage(storage);
}

export function writeStudioUiPreferences(
  patch: StudioUiPreferences,
  storage: Storage | null = getBrowserStorage(),
) {
  if (!storage) return;
  try {
    const next = {
      ...readStorage(storage),
      ...patch,
    };
    storage.setItem(STUDIO_UI_PREFERENCES_KEY, JSON.stringify(next));
  } catch {
    /* localStorage may be unavailable or full */
  }
}
