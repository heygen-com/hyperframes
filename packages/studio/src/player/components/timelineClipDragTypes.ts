import type { TimelineElement } from "../store/playerStore";
import type { TimelineSnapType } from "./timelineSnapping";
import type { BlockedTimelineEditIntent } from "./timelineEditing";

/* ── Shared clip-drag state types ───────────────────────────────── */
export interface DraggedClipState {
  element: TimelineElement;
  originClientX: number;
  originClientY: number;
  originScrollLeft: number;
  originScrollTop: number;
  pointerClientX: number;
  pointerClientY: number;
  pointerOffsetX: number;
  pointerOffsetY: number;
  previewStart: number;
  previewTrack: number;
  /**
   * When non-null, the drop inserts a NEW track at this visual row boundary
   * (0 = above the top lane, trackOrder.length = below the bottom) instead of
   * landing on previewTrack. Drives the insertion-line indicator.
   */
  insertRow: number | null;
  /** Snap target the clip will land on, for the guide highlight. */
  snapTime: number | null;
  snapType: TimelineSnapType | null;
  started: boolean;
}

export interface ResizingClipState {
  element: TimelineElement;
  edge: "start" | "end";
  originClientX: number;
  /**
   * scrollLeft at gesture start. Edge auto-scroll moves the content under a
   * stationary pointer, so the trim math folds (current − origin) scrollLeft
   * into the pointer x — mirroring resolveTimelineMove's scroll compensation.
   * Optional so pre-existing constructors/tests stay valid; when absent the
   * first preview update captures the current scrollLeft.
   */
  originScrollLeft?: number;
  previewStart: number;
  previewDuration: number;
  previewPlaybackStart?: number;
  started: boolean;
}

export interface BlockedClipState {
  element: TimelineElement;
  intent: BlockedTimelineEditIntent;
  originClientX: number;
  originClientY: number;
  started: boolean;
}
