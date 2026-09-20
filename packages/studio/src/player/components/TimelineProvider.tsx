import { createContext, useContext, type ComponentProps, type ReactNode } from "react";
import type { TimelineOverlaysProps } from "./TimelineOverlays";
import type { TimelineEmptyState } from "./TimelineEmptyState";
import type { TimelineProps } from "./TimelineTypes";
import type { TimelineRangeSelection } from "./timelineEditing";
import type { TimelineDropPlacement } from "./timelineCallbacks";
import type { Rect } from "../../utils/marqueeGeometry";
import type { ResizingClipState } from "./useTimelineClipDrag";
import type { TimelineLaneBaseProps } from "./timelineLaneProps";
import type { TimelineLaneGapStrips } from "./useTimelineGapHighlights";
import { useTimelineProviderState } from "./useTimelineProviderState";

export {
  shouldAutoScrollTimeline,
  getTimelineScrollLeftForZoomTransition,
  getTimelineScrollLeftForZoomAnchor,
  getTimelinePlaybackFollowScrollLeft,
  getTimelinePlayheadLeft,
  getTimelineCanvasHeight,
  shouldShowTimelineShortcutHint,
  resolveTimelineAssetDrop,
  shouldHandleTimelineDeleteKey,
  getDefaultDroppedTrack,
} from "./timelineLayout";
export { formatTimelineTickLabel, generateTicks } from "./timelineRulerGeometry";
export {
  getTimelineScrollTopForGeometryChange,
  getTimelineVisibleTimeRange,
} from "./timelineViewportGeometry";

type TimelineCanvasProps = Omit<
  TimelineLaneBaseProps,
  "setRangeSelection" | "setResizingClip" | "setDraggedClip"
> & {
  major: number[];
  minor: number[];
  totalH: number;
  effectiveDuration: number;
  majorTickInterval: number;
  rangeSelection: TimelineRangeSelection | null;
  marqueeRect: Rect | null;
  resizingClip: ResizingClipState | null;
  isScrubbing: boolean;
  playheadRef: React.RefObject<HTMLDivElement | null>;
  laneGapStrips: TimelineLaneGapStrips[];
  dropPreview: TimelineDropPlacement | null;
  setRangeSelection: (value: TimelineRangeSelection | null) => void;
  setResizingClip: (value: ResizingClipState | null) => void;
  setDraggedClip: (value: TimelineLaneBaseProps["draggedClip"]) => void;
};

export interface TimelineContextValue {
  state: {
    timelineReady: boolean;
    elements: readonly unknown[];
    canvasProps: TimelineCanvasProps;
    overlaysProps: TimelineOverlaysProps;
  };
  actions: Record<string, never>;
  meta: {
    renderClipContent: TimelineCanvasProps["renderClipContent"];
    renderClipOverlay: TimelineCanvasProps["renderClipOverlay"];
    emptyState: ComponentProps<typeof TimelineEmptyState>;
    containerProps: ComponentProps<"div">;
    viewportProps: ComponentProps<"div">;
    razorGuide: ReactNode;
  };
}

const TimelineContext = createContext<TimelineContextValue | null>(null);

export function TimelineProvider({ children, ...props }: TimelineProps & { children: ReactNode }) {
  const value = useTimelineProviderState(props);
  return <TimelineContext.Provider value={value}>{children}</TimelineContext.Provider>;
}

export function useTimelineContext(): TimelineContextValue {
  const value = useTimelineContextOptional();
  if (value === null) throw new Error("useTimelineContext must be used inside TimelineProvider");
  return value;
}

export function useTimelineContextOptional(): TimelineContextValue | null {
  return useContext(TimelineContext);
}
