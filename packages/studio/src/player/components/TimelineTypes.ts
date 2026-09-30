import type { ReactNode } from "react";
import type { TimelineElement } from "../store/playerStore";
import type { TimelineTimeRange } from "../store/rangeSelectionSlice";
import type { TimelineDropCallbacks } from "./timelineCallbacks";
import type { TimelineTheme } from "./timelineTheme";
import type { TimelineTrackPadding } from "./timelineLayout";
import type { TimelineEditOverrides } from "./useResolvedTimelineEditCallbacks";
import type { TimelineStackingSyncProps } from "./useTimelineStackingSync";

export interface TimelineClipRenderContext {
  priority: "overscan" | "visible" | "interaction";
  rich: boolean;
}

export interface TimelineProps
  extends TimelineDropCallbacks, TimelineEditOverrides, TimelineStackingSyncProps {
  /** Project-scoped reset boundary; soft source refreshes retain the same epoch. */
  sessionEpoch?: number;
  onSeek?: (time: number, options?: { keepPlaying?: boolean; follow?: boolean }) => void;
  onDrillDown?: (element: TimelineElement) => void;
  /** Picture only: takes no pointer input. Interactive content goes in renderClipOverlay. */
  renderClipContent?: (
    element: TimelineElement,
    style: { clip: string; label: string },
    context: TimelineClipRenderContext,
  ) => ReactNode;
  renderClipOverlay?: (element: TimelineElement) => ReactNode;
  onDeleteElement?: (element: TimelineElement) => Promise<void> | void;
  onSelectElement?: (element: TimelineElement | null) => void;
  /** Notification only; null when cleared. The value lives in usePlayerStore.rangeSelection. */
  onRangeSelect?: (range: TimelineTimeRange | null) => void;
  onCopyClip?: () => boolean;
  onPasteClip?: () => Promise<void>;
  onDuplicateClip?: () => Promise<boolean>;
  canPasteClip?: () => boolean;
  theme?: Partial<TimelineTheme>;
  showAudioEffects?: boolean;
  showKeyframes?: boolean;
  trackPadding?: TimelineTrackPadding;
  /** Seek, scroll, zoom, hover and selection stay live; every edit is refused before it starts. */
  readOnly?: boolean;
  /** Called once for each press read-only refused. */
  onReadOnlyPress?: () => void;
}
