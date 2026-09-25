import { memo } from "react";
import type { TimelineProps } from "./TimelineTypes";
import { TimelineEmptyState } from "./TimelineEmptyState";
import { TimelineCanvas } from "./TimelineCanvas";
import { TimelineOverlays } from "./TimelineOverlays";
import { TimelineProvider, useTimelineContext } from "./TimelineProvider";

export * from "./TimelineProvider";
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

function TimelineView() {
  const { state, meta } = useTimelineContext();
  const { timelineReady, elements } = state;
  if (!timelineReady || elements.length === 0) {
    return <TimelineEmptyState {...meta.emptyState} />;
  }
  return (
    <div {...meta.containerProps}>
      <div {...meta.viewportProps}>
        <TimelineCanvas />
        {meta.razorGuide}
      </div>
      <TimelineOverlays />
    </div>
  );
}

export const Timeline = memo(function Timeline(props: TimelineProps = {}) {
  return (
    <TimelineProvider {...props}>
      <TimelineView />
    </TimelineProvider>
  );
});
