import type { StoreApi } from "zustand";
import { readStudioUiPreferences, writeStudioUiPreferences } from "../../utils/studioUiPreferences";
import type { TimelineTrimMode } from "../components/timelineTrimOps";

/**
 * What the precision (two-up) view is currently showing.
 *
 * The trim gesture lives deep inside the timeline's drag hook while the view
 * renders above the timeline, so the two meet here rather than through props:
 * the gesture publishes the pair of composition times it is editing, the view
 * seeks its two players to them. Null while no trim gesture is running — the
 * view then falls back to the playhead.
 */
export interface TimelineTrimPreview {
  mode: TimelineTrimMode;
  /** Composition time for the LEFT (outgoing) pane. */
  outTime: number;
  /** Composition time for the RIGHT (incoming) pane. */
  inTime: number;
  /** Seconds the gesture has applied so far, for the readout. */
  delta: number;
}

export interface TrimPreviewSlice {
  trimPreview: TimelineTrimPreview | null;
  setTrimPreview: (preview: TimelineTrimPreview | null) => void;
  /**
   * Whether the precision view is wanted at all. It costs two extra
   * composition renders while a trim tool is active, so it is a preference the
   * user keeps rather than something forced on every project.
   */
  precisionTrimViewEnabled: boolean;
  setPrecisionTrimViewEnabled: (enabled: boolean) => void;
}

export function createTrimPreviewSlice(
  set: StoreApi<TrimPreviewSlice>["setState"],
): TrimPreviewSlice {
  return {
    trimPreview: null,
    setTrimPreview: (trimPreview) => set({ trimPreview }),
    precisionTrimViewEnabled: readStudioUiPreferences().precisionTrimViewEnabled ?? true,
    setPrecisionTrimViewEnabled: (precisionTrimViewEnabled) => {
      writeStudioUiPreferences({ precisionTrimViewEnabled });
      set({ precisionTrimViewEnabled });
    },
  };
}
