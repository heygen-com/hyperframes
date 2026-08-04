import { createJsonStore } from "./jsonStore";

export interface StoredPreviewZoomState {
  zoomPercent: number;
  panX: number;
  panY: number;
}

export type TimelineTimeDisplayMode = "time" | "frame";

/** Mirrors the server's AgentKind — see components/editor/agentGlyphs. */
export type StudioAgentKind = "claude" | "codex" | "hermes" | "openclaw" | "custom";

export interface StudioUiPreferences {
  leftCollapsed?: boolean;
  leftWidth?: number;
  rightWidth?: number;
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
  timeDisplayMode?: TimelineTimeDisplayMode;
  /**
   * Timeline zoom mode. Persisted so a zoom PINNED on the first edit survives the
   * post-edit iframe reload — otherwise the store reset to "fit" and the duration
   * change rescaled every clip (the blink-fix's rescale symptom).
   */
  timelineZoomMode?: "fit" | "manual";
  /** Manual timeline zoom percent, paired with `timelineZoomMode: "manual"`. */
  timelineManualZoomPercent?: number;
  /**
   * Harness the agent composer runs with. Sticky on purpose: picking Codex once
   * should not silently revert to whatever auto-detection finds first tomorrow.
   * Undefined means "let the server decide".
   */
  agentKind?: StudioAgentKind;
  /** Harness id (a built-in kind, or a custom harness' id). */
  agentId?: string;
  /** Run tray left collapsed. */
  agentTrayCollapsed?: boolean;
  /** Where the user parked the run tray, in viewport pixels. */
  agentTrayPosition?: { x: number; y: number };
  /** Model chosen per harness; unset means "the cheapest one that can run". */
  agentModelByKind?: Partial<Record<StudioAgentKind, string>>;
  /** Reasoning effort chosen per harness; unset means "the lowest offered". */
  agentEffortByKind?: Partial<Record<StudioAgentKind, string>>;
}

const AGENT_KINDS: StudioAgentKind[] = ["claude", "codex", "hermes", "openclaw", "custom"];

const STUDIO_UI_PREFERENCES_KEY = "hf-studio-ui-preferences";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

// fallow-ignore-next-line complexity
function parsePreferences(parsed: unknown): StudioUiPreferences {
  {
    if (!isRecord(parsed)) return {};

    const preferences: StudioUiPreferences = {};
    if (typeof parsed.leftCollapsed === "boolean") {
      preferences.leftCollapsed = parsed.leftCollapsed;
    }
    if (typeof parsed.leftWidth === "number" && Number.isFinite(parsed.leftWidth)) {
      preferences.leftWidth = parsed.leftWidth;
    }
    if (typeof parsed.rightWidth === "number" && Number.isFinite(parsed.rightWidth)) {
      preferences.rightWidth = parsed.rightWidth;
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
    if (typeof parsed.agentId === "string" && parsed.agentId) {
      preferences.agentId = parsed.agentId;
    }
    if (AGENT_KINDS.includes(parsed.agentKind as StudioAgentKind)) {
      preferences.agentKind = parsed.agentKind as StudioAgentKind;
    }
    if (typeof parsed.agentTrayCollapsed === "boolean") {
      preferences.agentTrayCollapsed = parsed.agentTrayCollapsed;
    }
    if (isRecord(parsed.agentModelByKind)) {
      const models: Partial<Record<StudioAgentKind, string>> = {};
      for (const kind of AGENT_KINDS) {
        const value = parsed.agentModelByKind[kind];
        if (typeof value === "string" && value) models[kind] = value;
      }
      if (Object.keys(models).length > 0) preferences.agentModelByKind = models;
    }
    if (isRecord(parsed.agentEffortByKind)) {
      const efforts: Partial<Record<StudioAgentKind, string>> = {};
      for (const kind of AGENT_KINDS) {
        const value = parsed.agentEffortByKind[kind];
        if (typeof value === "string" && value) efforts[kind] = value;
      }
      if (Object.keys(efforts).length > 0) preferences.agentEffortByKind = efforts;
    }
    if (isRecord(parsed.agentTrayPosition)) {
      const { x, y } = parsed.agentTrayPosition;
      if (
        typeof x === "number" &&
        Number.isFinite(x) &&
        typeof y === "number" &&
        Number.isFinite(y)
      ) {
        preferences.agentTrayPosition = { x, y };
      }
    }
    return preferences;
  }
}

const store = createJsonStore<StudioUiPreferences>({
  key: STUDIO_UI_PREFERENCES_KEY,
  fallback: {},
  parse: parsePreferences,
});

export function readStudioUiPreferences(storage?: Storage | null) {
  return storage === undefined ? store.read() : storeFor(storage).read();
}

export function writeStudioUiPreferences(patch: StudioUiPreferences, storage?: Storage | null) {
  const target = storage === undefined ? store : storeFor(storage);
  target.update(patch);
}

/** Tests (and any non-default Storage) get their own store over the same shape. */
function storeFor(storage: Storage | null) {
  return createJsonStore<StudioUiPreferences>({
    key: STUDIO_UI_PREFERENCES_KEY,
    fallback: {},
    parse: parsePreferences,
    storage: () => storage,
  });
}
