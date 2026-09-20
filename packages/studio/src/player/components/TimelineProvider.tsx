import { createContext, useContext, type ComponentProps, type ReactNode } from "react";
import type { TimelineCanvas } from "./TimelineCanvas";
import type { TimelineOverlays } from "./TimelineOverlays";
import type { TimelineEmptyState } from "./TimelineEmptyState";
import type { TimelineProps } from "./TimelineTypes";
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

type TimelineCanvasProps = ComponentProps<typeof TimelineCanvas>;
type TimelineOverlaysProps = ComponentProps<typeof TimelineOverlays>;

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
