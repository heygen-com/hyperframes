export interface StoredPreviewZoomState {
  zoomPercent: number;
  panX: number;
  panY: number;
}

export interface StudioUiPreferences {
  leftCollapsed?: boolean;
  timelineVisible?: boolean;
  timelineHeight?: number;
  playbackRate?: number;
  audioMuted?: boolean;
  previewZoom?: StoredPreviewZoomState;
  recentBlocks?: string[];
  snapEnabled?: boolean;
  gridVisible?: boolean;
  gridSpacing?: number;
  snapToGrid?: boolean;
  /** Timeline magnet: snap clip drags/trims/drops to playhead, clip edges, and beats. */
  timelineSnapEnabled?: boolean;
  /** Transport + ruler readout mode: timecode or frame number. */
  timeDisplayMode?: "time" | "frame";
  /**
   * Timeline zoom mode. Persisted so a zoom PINNED on the first edit survives the
   * post-edit iframe reload — otherwise the store reset to "fit" and the duration
   * change rescaled every clip (the blink-fix's rescale symptom).
   */
  timelineZoomMode?: "fit" | "manual";
  /** Manual timeline zoom percent, paired with `timelineZoomMode: "manual"`. */
  timelineManualZoomPercent?: number;
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

// fallow-ignore-next-line complexity
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
    if (typeof parsed.timelineHeight === "number" && Number.isFinite(parsed.timelineHeight)) {
      preferences.timelineHeight = parsed.timelineHeight;
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
    if (Array.isArray(parsed.recentBlocks)) {
      preferences.recentBlocks = parsed.recentBlocks.filter(
        (v: unknown): v is string => typeof v === "string",
      );
    }
    if (typeof parsed.snapEnabled === "boolean") {
      preferences.snapEnabled = parsed.snapEnabled;
    }
    if (typeof parsed.gridVisible === "boolean") {
      preferences.gridVisible = parsed.gridVisible;
    }
    if (typeof parsed.gridSpacing === "number" && Number.isFinite(parsed.gridSpacing)) {
      preferences.gridSpacing = parsed.gridSpacing;
    }
    if (typeof parsed.snapToGrid === "boolean") {
      preferences.snapToGrid = parsed.snapToGrid;
    }
    if (typeof parsed.timelineSnapEnabled === "boolean") {
      preferences.timelineSnapEnabled = parsed.timelineSnapEnabled;
    }
    if (parsed.timeDisplayMode === "time" || parsed.timeDisplayMode === "frame") {
      preferences.timeDisplayMode = parsed.timeDisplayMode;
    }
    if (parsed.timelineZoomMode === "fit" || parsed.timelineZoomMode === "manual") {
      preferences.timelineZoomMode = parsed.timelineZoomMode;
    }
    if (
      typeof parsed.timelineManualZoomPercent === "number" &&
      Number.isFinite(parsed.timelineManualZoomPercent)
    ) {
      preferences.timelineManualZoomPercent = parsed.timelineManualZoomPercent;
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
