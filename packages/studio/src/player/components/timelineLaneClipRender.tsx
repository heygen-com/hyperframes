import { Fragment, type CSSProperties, type RefObject } from "react";
import { TimelineLaneClip, type TimelineLaneClipActions } from "./TimelineLaneClip";
import { TimelineCompactDiamonds } from "./TimelineCompactDiamonds";
import { TimelinePropertyLanes } from "./TimelinePropertyLanes";
import { clipWidthPx } from "./TimelineClip";
import { clipTimingStart } from "../../hooks/gsapShared";
import type { useTimelineClipCapabilities } from "./timelineReadOnly";
import { isMultiDragPassenger, multiDragPassengerOffsetPx } from "./timelineMultiDragPreview";
import type { TimelineLanesProps } from "./timelineLaneProps";
import type { TimelineElement } from "../store/playerStore";
import { resolveClipRenderContext } from "./timelineClipChildren";
import { isTimelineClipActive } from "./useTimelineActiveClips";
import { getTimelineElementIdentity } from "../lib/timelineElementHelpers";
import { timelineClipFocusId } from "./timelineNavigationIdentity";
import type { useTimelineKeyboardActor } from "./useTimelineKeyboardActor";

export interface LaneClipContext {
  props: TimelineLanesProps;
  keyboard: Pick<ReturnType<typeof useTimelineKeyboardActor>, "rovingTargetId">;
  getClipCapabilities: ReturnType<typeof useTimelineClipCapabilities>;
  clipActions: RefObject<TimelineLaneClipActions>;
}

export interface LaneClipTrack {
  keyframeClipKey: string | undefined;
  rowExpanded: boolean;
  clipBarHeight: number | undefined;
  rowHeight: number;
  beatStripOnTrack: boolean;
  lanesId: string;
}

export const isSelectedKey = (props: TimelineLanesProps, key: string) =>
  props.selectedElementId === key || props.selectedElementIds.has(key);

function passengerStyleAt(offsetPx: number): CSSProperties {
  return {
    transform: `translateX(${offsetPx}px)`,
    opacity: 0.85,
    zIndex: 20,
    pointerEvents: "none",
  };
}

function isDraggedClip(props: TimelineLanesProps, elementKey: string) {
  return (
    props.draggedClip?.started === true &&
    props.draggedElement != null &&
    getTimelineElementIdentity(props.draggedElement) === elementKey
  );
}

// Passenger of a live multi-drag: preserve the formation without changing
// the passenger's timeline data until the owning drag commits.
function passengerStyleFor(props: TimelineLanesProps, clipKey: string) {
  const preview = props.multiDragPreview;
  if (preview == null || !isMultiDragPassenger(clipKey, preview)) return undefined;
  return passengerStyleAt(multiDragPassengerOffsetPx(clipKey, props.pps, preview));
}

export function renderLaneClip(lanes: LaneClipContext, track: LaneClipTrack, el: TimelineElement) {
  const { props } = lanes;
  const clipStyle = props.getTrackStyle(el.tag);
  // Element identity stays stable across clip splices and reorders.
  const elementKey = getTimelineElementIdentity(el);
  if (isDraggedClip(props, elementKey)) return null;
  // Only the track's active keyframe clip shows expanded lanes;
  // other clips (incl. siblings on a shared track) show compact
  // diamonds on their own bar instead.
  const isTrackKeyframeClip = elementKey === track.keyframeClipKey;
  const isSelected = isSelectedKey(props, elementKey);
  const isHovered = props.hoveredClip === elementKey;
  const previewElement = props.getPreviewElement(el);
  const renderContext = resolveClipRenderContext(
    previewElement,
    props.visibleTimeRange,
    isSelected || isHovered || props.pinnedClipIdentities.has(elementKey),
  );
  const passengerStyle = passengerStyleFor(props, elementKey);
  const showsLanes = isTrackKeyframeClip && track.rowExpanded;
  // No wrapper node per clip, and the same Fragment whether or not it rides a
  // drag, so joining or leaving one restyles it, never remounts it.
  return (
    <Fragment key={elementKey}>
      <TimelineLaneClip
        key={elementKey}
        el={el}
        previewElement={previewElement}
        elementKey={elementKey}
        capabilities={lanes.getClipCapabilities(el)}
        pps={props.pps}
        passengerStyle={passengerStyle}
        clipBarHeight={track.clipBarHeight}
        isSelected={isSelected}
        isHovered={isHovered}
        isActive={isTimelineClipActive(previewElement, props.currentTime)}
        tabIndex={lanes.keyboard.rovingTargetId === timelineClipFocusId(elementKey) ? 0 : -1}
        priority={renderContext.priority}
        rich={renderContext.rich}
        theme={props.theme}
        clipStyle={clipStyle}
        renderClipContent={props.renderClipContent}
        renderClipOverlay={props.renderClipOverlay}
        actions={lanes.clipActions}
      />
      {!showsLanes &&
        renderCompactDiamonds(
          lanes,
          track,
          previewElement,
          elementKey,
          clipStyle.accent,
          isSelected,
          passengerStyle,
        )}
      {/* Keep this shell mounted while collapsed so aria-controls stays valid
          and multi-drag cannot remount the subtree mid-gesture. */}
      {isTrackKeyframeClip &&
        renderPropertyLanes(
          lanes,
          track,
          previewElement,
          elementKey,
          clipStyle.accent,
          isSelected,
          passengerStyle,
          showsLanes,
        )}
    </Fragment>
  );
}

function renderCompactDiamonds(
  lanes: LaneClipContext,
  track: LaneClipTrack,
  previewElement: TimelineElement,
  elementKey: string,
  accentColor: string,
  isSelected: boolean,
  passengerStyle: CSSProperties | undefined,
) {
  const { props } = lanes;
  const compactKeyframes = props.keyframeCache?.get(elementKey);
  return (
    compactKeyframes && (
      <TimelineCompactDiamonds
        key={`${elementKey}-diamonds`}
        element={previewElement}
        elementId={elementKey}
        keyframesData={compactKeyframes}
        pixelsPerSecond={props.pps}
        rowHeight={track.rowHeight}
        beatsActive={track.beatStripOnTrack}
        accentColor={accentColor}
        isSelected={isSelected}
        passengerStyle={passengerStyle}
        currentTime={props.currentTime}
        selectedKeyframes={props.selectedKeyframes}
        rovingTargetId={lanes.keyboard.rovingTargetId}
        onClickKeyframe={props.onClickKeyframe}
        onShiftClickKeyframe={props.onShiftClickKeyframe}
        onContextMenuKeyframe={props.onContextMenuKeyframe}
        onMoveKeyframe={props.onMoveKeyframe}
        onSelectSegment={props.onSelectSegment}
        suppressClickRef={props.suppressClickRef}
      />
    )
  );
}

function renderPropertyLanes(
  lanes: LaneClipContext,
  track: LaneClipTrack,
  previewElement: TimelineElement,
  elementKey: string,
  accentColor: string,
  isSelected: boolean,
  passengerStyle: CSSProperties | undefined,
  showsLanes: boolean,
) {
  const { props } = lanes;
  const { pps, currentTime } = props;
  return (
    <TimelinePropertyLanes
      key={`${elementKey}-property-lanes`}
      id={track.lanesId}
      animations={showsLanes ? (props.gsapAnimations.get(elementKey) ?? []) : []}
      // clipTimingStart, not the raw start: an expanded sub-comp
      // child's start is host-absolute while its tweens are
      // local to its own file.
      clipStart={clipTimingStart(previewElement)}
      clipDuration={previewElement.duration}
      clipLeftPx={previewElement.start * pps}
      clipWidthPx={clipWidthPx(previewElement, pps)}
      passengerStyle={passengerStyle}
      accentColor={accentColor}
      isSelected={isSelected}
      currentPercentage={
        previewElement.duration > 0
          ? ((currentTime - previewElement.start) / previewElement.duration) * 100
          : 0
      }
      elementId={elementKey}
      selectedKeyframes={props.selectedKeyframes}
      rovingTargetId={lanes.keyboard.rovingTargetId}
      onSelectSegment={(target) => props.onSelectSegment?.(elementKey, target)}
      onClickKeyframe={(target) => props.onClickKeyframe?.(previewElement, target)}
      onShiftClickKeyframe={(target) => props.onShiftClickKeyframe?.(elementKey, target)}
      onContextMenuKeyframe={(e, target) => props.onContextMenuKeyframe?.(e, elementKey, target)}
      onMoveKeyframe={(target, toClipPercentage) =>
        props.onMoveKeyframe?.(elementKey, target, toClipPercentage) ?? Promise.resolve(false)
      }
      suppressClickRef={props.suppressClickRef}
    />
  );
}
