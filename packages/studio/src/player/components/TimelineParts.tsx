import { memo } from "react";
import { TimelineCanvas as TimelineCanvasImpl } from "./TimelineCanvas";
import { TimelineOverlays as TimelineOverlaysImpl } from "./TimelineOverlays";
import { TimelineLanes as TimelineLanesImpl } from "./TimelineLanes";
import { PlayheadIndicator } from "./PlayheadIndicator";
import { useTimelineContext } from "./TimelineProvider";
import { TimelineEmptyState } from "./TimelineEmptyState";
import { TimelineRulerPart } from "./TimelineRulerPart";

/** The provider-backed canvas shell. */
export const TimelineFrame = memo(function TimelineFrame() {
  return <TimelineCanvasImpl />;
});

/** The provider-backed ruler. */
export const TimelineRuler = TimelineRulerPart;

/**
 * The provider-backed lane renderer. TimelineFrame remains the composed Studio
 * canvas; this part is exported for hosts that own the canvas arrangement.
 */
export const TimelineLanes = memo(function TimelineLanes() {
  const { state, actions } = useTimelineContext();
  const props = state.canvas;
  const laneProps = props as unknown as Parameters<typeof TimelineLanesImpl>[0];
  return (
    <TimelineLanesImpl
      {...laneProps}
      renderClipContent={actions.renderClipContent}
      renderClipOverlay={actions.renderClipOverlay}
    />
  );
});

/** The provider-backed playhead indicator. */
export const TimelinePlayhead = memo(function TimelinePlayhead() {
  const { state } = useTimelineContext();
  const props = state.canvas;
  return <PlayheadIndicator scrubbing={props.isScrubbing} />;
});

/** The provider-backed razor guide. */
export const TimelineRazorGuide = memo(function TimelineRazorGuide() {
  const { meta } = useTimelineContext();
  return meta.razorGuide;
});

/** The composed overlay surface used by the Studio variant. */
export const TimelineOverlaysPart = memo(function TimelineOverlaysPart() {
  return <TimelineOverlaysImpl />;
});

export const TimelineEmptyStatePart = memo(function TimelineEmptyStatePart() {
  const { meta } = useTimelineContext();
  return <TimelineEmptyState {...meta.emptyState} />;
});

export const TimelineShortcutHint = memo(function TimelineShortcutHint() {
  return <TimelineOverlaysImpl part="shortcut" />;
});
export const TimelineEditPopover = memo(function TimelineEditPopover() {
  return <TimelineOverlaysImpl part="edit" />;
});
export const TimelineClipMenu = memo(function TimelineClipMenu() {
  return <TimelineOverlaysImpl part="clip" />;
});
export const TimelineKeyframeMenu = memo(function TimelineKeyframeMenu() {
  return <TimelineOverlaysImpl part="keyframe" />;
});
export const TimelineGapMenu = memo(function TimelineGapMenu() {
  return <TimelineOverlaysImpl part="gap" />;
});
