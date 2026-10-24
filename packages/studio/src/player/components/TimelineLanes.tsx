import { useId, useMemo, useRef } from "react";
import { BeatStrip, BeatBackgroundLines } from "./BeatStrip";
import type { TimelineLaneClipActions } from "./TimelineLaneClip";
import { TimelineAutomationLaneSlot } from "./TimelineAutomationLaneSlot";
import { useAutomationLanes } from "./useAutomationLanes";
import { useAutomationSelectionKeyboard } from "../../hooks/useAutomationSelectionKeyboard";
import { TimelineTrackHeader } from "./TimelineTrackHeader";
import { TimelineGroupRow } from "./TimelineGroupRow";
import { useTimelineLaneRowIndexes, useTimelineGroupDisclosure } from "./useTimelineLaneRowIndexes";
import { useTimelineClipDisclosure } from "./useTimelineClipDisclosure";
import { TimelineTimeLayer } from "./TimelineTimeLayer";
import {
  isTrackRowExpanded,
  resolveTrackKeyframeClip,
  trackShowsBeatStrip,
} from "./useTimelineTrackLayout";
import { trackDisplayNumber, trackDisplaySuffix } from "./timelineTrackDisplay";
import { useTimelineClipCapabilities } from "./timelineReadOnly";
import { CLIP_Y, TRACK_H } from "./timelineLayout";
import { usePlayerStore } from "../store/playerStore";
import { useTimelineMultiDragActorWindows } from "./useTimelineMultiDragActorWindows";
import type { TimelineLanesProps } from "./timelineLaneProps";
import type { TimelineElement } from "../store/playerStore";
import type { TimelineVirtualRow } from "./useTimelineVirtualRows";
import { isAudioTimelineElement, isMusicTrack } from "../../utils/timelineInspector";
import { TimelineTrackRow } from "./TimelineTrackRow";
import { queryTimelineClipIndex } from "../lib/timelineClipIndex";
import { withoutHiddenSlivers } from "./timelineSlivers";
import { getTimelineElementIdentity } from "../lib/timelineElementHelpers";
import { timelineClipFocusId } from "./timelineNavigationIdentity";
import { useTimelineKeyboardActor } from "./useTimelineKeyboardActor";
import { TimelineTransitionOverlays } from "./TimelineTransitionOverlays";
import { deriveTimelineTransitionSeamsByTrack } from "./timelineTransitionSeams";
import { isSelectedKey, renderLaneClip } from "./timelineLaneClipRender";

function useTimelineLanes(props: TimelineLanesProps) {
  const { tracks, getPreviewElement, logicalRows, rowsVirtualized, renderTimeRange } = props;
  // ponytail: One per-instance namespace prevents aria-controls and aria-owns
  // from resolving into a second timeline that renders the same logical rows.
  const lanesIdPrefix = `timeline-lanes${useId().replaceAll(":", "")}`;
  const expandedClipIds = usePlayerStore((s) => s.expandedClipIds);
  const disclosure = useTimelineGroupDisclosure();
  const automationLanes = useAutomationLanes();
  const getClipCapabilities = useTimelineClipCapabilities();
  const transitionSeamsByTrack = useMemo(
    () =>
      deriveTimelineTransitionSeamsByTrack(tracks.flatMap(([, els]) => els.map(getPreviewElement))),
    [getPreviewElement, tracks],
  );
  // A group's automation clock is COMPOSITION time (groups doc §1.3), so its
  // synthetic lane element spans the whole composition rather than a clip.
  const compositionDuration = usePlayerStore((s) => s.duration);
  useAutomationSelectionKeyboard({ lanes: automationLanes });
  const rowIndexes = useTimelineLaneRowIndexes(logicalRows, props.groups);
  const {
    toggleRowExpanded: toggleRowExpandedTracked,
    toggleClipExpanded: toggleClipExpandedTracked,
  } = useTimelineClipDisclosure();
  const actorWindows = useTimelineMultiDragActorWindows(
    props.multiDragPreview,
    rowsVirtualized,
    renderTimeRange,
  );
  const keyboard = useTimelineKeyboardActor({
    logicalRows,
    focusedTargetId: props.focusedTargetId,
    rowGeometry: props.rowGeometry,
    scrollRef: props.scrollRef,
    onToggleRow: (row) => row.elementId && toggleClipExpandedTracked(row.elementId),
    onDrillDown: props.onDrillDown,
  });
  const clipActions = useRef<TimelineLaneClipActions>(null!);
  clipActions.current = laneClipActions(props);
  return {
    props,
    lanesIdPrefix,
    expandedClipIds,
    ...disclosure,
    automationLanes,
    getClipCapabilities,
    transitionSeamsByTrack,
    compositionDuration,
    ...rowIndexes,
    toggleRowExpandedTracked,
    actorWindows,
    keyboard,
    clipActions,
  };
}

type Lanes = ReturnType<typeof useTimelineLanes>;

function laneClipActions(props: TimelineLanesProps): TimelineLaneClipActions {
  return {
    gestures: {
      pps: props.pps,
      onResizeElement: props.onResizeElement,
      onMoveElement: props.onMoveElement,
      onRazorSplit: props.onRazorSplit,
      onRazorSplitAll: props.onRazorSplitAll,
      blockedClipRef: props.blockedClipRef,
      suppressClickRef: props.suppressClickRef,
      scrollRef: props.scrollRef,
      setShowPopover: props.setShowPopover,
      setRangeSelection: props.setRangeSelection,
      setResizingClip: props.setResizingClip,
      setDraggedClip: props.setDraggedClip,
      setSelectedElementId: props.setSelectedElementId,
      onSelectElement: props.onSelectElement,
    },
    setHoveredClip: props.setHoveredClip,
    onContextMenuClip: props.onContextMenuClip,
    onDrillDown: props.onDrillDown,
  };
}

export function TimelineLanes(props: TimelineLanesProps) {
  const lanes = useTimelineLanes(props);
  return (
    <div
      role="treegrid"
      aria-label="Timeline tracks"
      aria-rowcount={props.logicalRows.length}
      aria-colcount={2}
      onFocus={lanes.keyboard.onFocus}
      onKeyDown={lanes.keyboard.onKeyDown}
      className={props.rowsVirtualized ? "absolute inset-0" : undefined}
    >
      {props.virtualRows.map(({ index, rowKey }) => renderLaneRow(lanes, index, rowKey))}
    </div>
  );
}

function renderLaneRow(lanes: Lanes, row: number, rowKey: TimelineVirtualRow["rowKey"]) {
  const { props } = lanes;
  const trackNum = props.displayTrackOrder[row];
  if (trackNum === undefined) return null;
  const group = lanes.groupByAnchor.get(trackNum);
  if (group) return renderGroupRow(lanes, row, rowKey, trackNum, group);
  const trackLogicalRows = lanes.logicalRowsByTrack.get(trackNum) ?? [];
  if (!trackLogicalRows[0]) return null;
  const els = trackElements(props, trackNum);
  if (isPendingTrack(props, trackNum, els)) return renderPendingTrack(props, row, rowKey);
  return renderTrackRow(lanes, trackRowModel(lanes, row, trackNum, els, trackLogicalRows), rowKey);
}

function trackElements(props: TimelineLanesProps, trackNum: number): TimelineElement[] {
  return props.tracks.find(([t]) => t === trackNum)?.[1] ?? [];
}

function isPendingTrack(props: TimelineLanesProps, trackNum: number, els: TimelineElement[]) {
  return (
    props.draggedClip?.started === true && !props.trackOrder.includes(trackNum) && els.length === 0
  );
}

function renderGroupRow(
  lanes: Lanes,
  row: number,
  rowKey: TimelineVirtualRow["rowKey"],
  trackNum: number,
  group: NonNullable<ReturnType<Lanes["groupByAnchor"]["get"]>>,
) {
  const { props } = lanes;
  const groupLogicalRow = lanes.logicalRowsByTrack.get(trackNum)?.[0];
  if (!groupLogicalRow) return null;
  return (
    <TimelineGroupRow
      key={rowKey}
      index={row}
      rowKey={rowKey}
      group={group}
      logicalRow={groupLogicalRow}
      top={props.rowGeometry.getRowTop(row)}
      height={props.rowGeometry.getRowHeight(row)}
      virtualized={props.rowsVirtualized}
      contentOrigin={props.contentOrigin}
      theme={props.theme}
      showAudioEffects={props.showAudioEffects}
      rovingTargetId={lanes.keyboard.rovingTargetId}
      collapsedGroupIds={lanes.collapsedGroupIds}
      expandedLaneOwnerIds={lanes.expandedLaneOwnerIds}
      toggleGroupExpanded={lanes.toggleGroupExpanded}
      toggleLaneOwnerExpanded={lanes.toggleLaneOwnerExpanded}
      lanes={lanes.automationLanes}
      pps={props.pps}
      currentTime={props.currentTime}
      compositionDuration={lanes.compositionDuration}
      beatTimes={props.beatAnalysis?.beatTimes}
      contentGutter={props.contentGutter}
      trackContentWidth={props.trackContentWidth}
    />
  );
}

function renderPendingTrack(
  props: TimelineLanesProps,
  row: number,
  rowKey: TimelineVirtualRow["rowKey"],
) {
  return (
    <div
      key={rowKey}
      data-timeline-new-track-lane={row}
      aria-hidden="true"
      className={props.rowsVirtualized ? "absolute" : "relative"}
      style={{
        top: props.rowsVirtualized ? props.rowGeometry.getRowTop(row) : undefined,
        marginLeft: props.contentOrigin,
        width: props.trackContentWidth,
        height: TRACK_H,
        border: "1px dashed var(--timeline-accent)",
        background: "color-mix(in srgb, var(--timeline-accent) 5%, transparent)",
        pointerEvents: "none",
      }}
    />
  );
}

function renderedTrackElements(
  lanes: Lanes,
  trackNum: number,
  els: TimelineElement[],
  keyframeClipKey: string | undefined,
): readonly TimelineElement[] {
  const { props } = lanes;
  if (!props.rowsVirtualized) return els;
  return withoutHiddenSlivers(
    queryTimelineClipIndex(
      props.clipIndex,
      trackNum,
      props.renderTimeRange,
      props.pinnedClipIdentities,
      lanes.actorWindows,
    ),
    props.pps,
    (el) => {
      const key = getTimelineElementIdentity(el);
      return (
        props.pinnedClipIdentities.has(key) ||
        // It holds the lanes the header caret's aria-controls names.
        key === keyframeClipKey ||
        isSelectedKey(props, key) ||
        props.hoveredClip === key ||
        lanes.keyboard.rovingTargetId === timelineClipFocusId(key)
      );
    },
  );
}

// The header's remove buttons write through the same binding the lanes
// themselves edit through, so a deletion persists exactly like dragging
// a point does — and the binding reports read-only for an unselected
// clip, which is what leaves the buttons off rather than offering one
// that cannot act.
function removeAutomationLaneHandler(
  lanes: Lanes,
  keyframeClip: TimelineElement | null,
  keyframeClipKey: string | undefined,
) {
  if (!keyframeClip || !keyframeClipKey) return undefined;
  const headerLanes = lanes.automationLanes.bind(
    keyframeClip,
    isSelectedKey(lanes.props, keyframeClipKey),
  );
  if (headerLanes.readOnly) return undefined;
  return (target: string) =>
    headerLanes.onCommit({
      version: 1,
      lanes: headerLanes.lanes.filter((lane) => lane.target !== target),
    });
}

function trackRowModel(
  lanes: Lanes,
  row: number,
  trackNum: number,
  els: TimelineElement[],
  trackLogicalRows: NonNullable<ReturnType<Lanes["logicalRowsByTrack"]["get"]>>,
) {
  const { props } = lanes;
  // Only the selected/most-keyframed clip owns expanded lanes on a shared track.
  const keyframeClip = resolveTrackKeyframeClip(
    els,
    props.laneCounts,
    props.selectedElementId,
    props.selectedElementIds,
  );
  const keyframeClipKey = keyframeClip?.key ?? keyframeClip?.id;
  const rowExpanded = isTrackRowExpanded(els, lanes.expandedClipIds);
  // Minted here because this is the only place that sees BOTH ends of
  // the disclosure: the caret in the sticky header and the diamond lanes
  // on the canvas. Keyed by display row, not by `trackNum`, which is a
  // fractional sort key and would mint ids like `...-0.16666666666666666`.
  const lanesId = `${lanes.lanesIdPrefix}-track-${row}`;
  return {
    row,
    trackNum,
    els,
    trackLogicalRows,
    rowHeight: props.rowGeometry.getRowHeight(row),
    keyframeClip,
    keyframeClipKey,
    renderElements: renderedTrackElements(lanes, trackNum, els, keyframeClipKey),
    beatStripOnTrack: trackShowsBeatStrip(els, props.beatAnalysis?.beatTimes, {
      selectedElementId: props.selectedElementId,
      isMusicTrack,
    }),
    isTrackHidden: els.length > 0 && els.every((element) => element.hidden === true),
    rowExpanded,
    // How tall a clip BAR is drawn. An expanded row is mostly lanes, and a
    // clip left to fill it painted its waveform straight over them — so the
    // bar is capped for every clip on the row, not just the one whose
    // property lanes are showing. Undefined means "fill the row", which is
    // right only while it is collapsed and the row is nothing but bar.
    clipBarHeight: rowExpanded ? TRACK_H - 2 * CLIP_Y : undefined,
    automationElements: els.map(props.getPreviewElement),
    lanesId,
    // The caret reveals two canvas regions now: the active clip's keyframe
    // lanes and the track's automation lanes. They cannot be one element —
    // one belongs to a clip, the other to the row — so the caret names both.
    automationLanesId: `${lanesId}-automation`,
  };
}

type TrackRow = ReturnType<typeof trackRowModel>;

function renderTrackRow(lanes: Lanes, track: TrackRow, rowKey: TimelineVirtualRow["rowKey"]) {
  const { props } = lanes;
  return (
    <TimelineTrackRow
      key={rowKey}
      index={track.row}
      rowKey={rowKey}
      logicalRow={track.trackLogicalRows[0]!}
      propertyRows={track.trackLogicalRows.slice(1)}
      lanesId={track.lanesId}
      headerLanesId={`${track.lanesId} ${track.automationLanesId}`}
      top={props.rowGeometry.getRowTop(track.row)}
      height={track.rowHeight}
      virtualized={props.rowsVirtualized}
      background={props.theme.rowBackground}
      borderColor={props.theme.rowBorder}
      rovingTargetId={lanes.keyboard.rovingTargetId}
    >
      {renderTrackHeader(lanes, track)}
      {renderTrackCanvas(lanes, track)}
    </TimelineTrackRow>
  );
}

function trackLabel(els: TimelineElement[], displayNumber: ReturnType<typeof trackDisplayNumber>) {
  return (
    els[0]?.label ?? els[0]?.domId ?? els[0]?.id ?? `Track${trackDisplaySuffix(displayNumber)}`
  );
}

function renderTrackHeader(lanes: Lanes, track: TrackRow) {
  const { props } = lanes;
  const { els, keyframeClipKey } = track;
  const displayNumber = trackDisplayNumber(props.displayTrackOrder, track.trackNum);
  return (
    <TimelineTrackHeader
      trackNumber={track.trackNum}
      // What gets announced. `trackNum` is a fractional z-order sort
      // key, so it stays out of every label and in every callback.
      trackDisplayNumber={displayNumber}
      trackLabel={trackLabel(els, displayNumber)}
      lanesId={`${track.lanesId} ${track.automationLanesId}`}
      contentOrigin={props.contentOrigin}
      keyframeClip={track.keyframeClip}
      trackElements={els}
      clipCount={els.length}
      isExpanded={track.rowExpanded}
      animations={keyframeClipKey ? (props.gsapAnimations.get(keyframeClipKey) ?? []) : []}
      currentTime={props.currentTime}
      isTrackHidden={track.isTrackHidden}
      isAudioTrack={els.length > 0 && els.some(isAudioTimelineElement)}
      isGroupMember={lanes.groupMemberTracks.has(track.trackNum)}
      theme={props.theme}
      showAudioEffects={props.showAudioEffects}
      onToggleClipExpanded={() => {
        const keys = els.map(getTimelineElementIdentity);
        if (keys.length > 0) lanes.toggleRowExpandedTracked(keys);
      }}
      onToggleTrackHidden={props.onToggleTrackHidden}
      onTogglePropertyGroupKeyframe={props.onTogglePropertyGroupKeyframe}
      onRemoveAutomationLane={removeAutomationLaneHandler(
        lanes,
        track.keyframeClip,
        keyframeClipKey,
      )}
      onSeek={props.onSeek}
      rovingTargetId={lanes.keyboard.rovingTargetId}
    />
  );
}

function renderTrackCanvas(lanes: Lanes, track: TrackRow) {
  const { props } = lanes;
  const { pps, onContextMenuLane } = props;
  return (
    <div
      role="gridcell"
      aria-colindex={2}
      data-timeline-zoom-scale=""
      style={{
        width: props.trackContentWidth,
        marginLeft: props.contentGutter, // room for a 0% diamond left of t=0
        opacity: track.isTrackHidden ? 0.35 : 1,
        transition: "opacity 120ms ease",
      }}
      className="relative"
      onContextMenu={(e: React.MouseEvent) => {
        // Clip / keyframe-diamond context menus preventDefault at the
        // target before this bubble handler runs — respect them so a
        // right-click on a clip never also opens the gap menu.
        if (e.defaultPrevented || !onContextMenuLane) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const time = (e.clientX - rect.left) / pps;
        if (time < 0) return;
        e.preventDefault();
        onContextMenuLane(e, track.trackNum, time);
      }}
    >
      {/* Faint beat lines in every track's background (behind the clips);
          the active move-snap target is highlighted. */}
      {renderBeatLines(props)}
      {/* Beat dots on the active track (the one holding the selection),
          falling back to the music track when nothing is selected. */}
      {track.beatStripOnTrack && renderBeatStrip(props)}
      <TimelineTimeLayer pixelsPerSecond={pps}>
        {track.renderElements.map((el) => renderLaneClip(lanes, track, el))}
      </TimelineTimeLayer>
      <TimelineTransitionOverlays
        seams={lanes.transitionSeamsByTrack.get(track.trackNum) ?? []}
        rowElements={props.draggedClip?.started ? [] : track.automationElements}
        rowBackground={props.theme.rowBackground}
        pixelsPerSecond={pps}
        rowHeight={track.rowHeight}
        clipBarHeight={track.clipBarHeight}
      />
      {/* The automation lanes belong to the ROW, so they are mounted
          here rather than under the active clip's property lanes.
          Hanging off that clip meant selecting a sibling moved the
          whole subtree into a different clip's element and remounted
          every lane — which threw away each lane's hover state (and
          any gesture mid-flight), so pressing a lane to select its
          clip made the handles you were reaching for disappear.

          Mounted in BOTH disclosure states, empty while collapsed, so
          the caret's aria-controls resolves either way — same reason
          the keyframe lanes are. Absolute positions inside resolve
          against this same relative row, so the geometry is unchanged
          by the move. */}
      <div id={track.automationLanesId}>
        {track.rowExpanded ? renderAutomationLaneSlot(lanes, track) : null}
      </div>
    </div>
  );
}

function beatRenderTimeRange(props: TimelineLanesProps) {
  return props.rowsVirtualized ? props.renderTimeRange : undefined;
}

function renderBeatLines(props: TimelineLanesProps) {
  const { beatAnalysis, snapGuide } = props;
  return (
    <BeatBackgroundLines
      beatTimes={beatAnalysis?.beatTimes}
      beatStrengths={beatAnalysis?.beatStrengths}
      pps={props.pps}
      highlightTime={snapGuide?.type === "beat" ? snapGuide.time : null}
      renderTimeRange={beatRenderTimeRange(props)}
    />
  );
}

function renderBeatStrip(props: TimelineLanesProps) {
  const { beatAnalysis } = props;
  return (
    <BeatStrip
      beatTimes={beatAnalysis?.beatTimes}
      beatStrengths={beatAnalysis?.beatStrengths}
      pps={props.pps}
      renderTimeRange={beatRenderTimeRange(props)}
    />
  );
}

function renderAutomationLaneSlot(lanes: Lanes, track: TrackRow) {
  const { props } = lanes;
  const { keyframeClipKey } = track;
  return (
    <TimelineAutomationLaneSlot
      elements={track.automationElements}
      isSelected={(element) => isSelectedKey(props, getTimelineElementIdentity(element))}
      lanes={lanes.automationLanes}
      pps={props.pps}
      laneCount={keyframeClipKey ? (props.laneCounts.get(keyframeClipKey) ?? 0) : 0}
      accentColor={props.getTrackStyle(track.keyframeClip?.tag ?? "").accent}
      currentTime={props.currentTime}
      beatTimes={props.beatAnalysis?.beatTimes}
    />
  );
}
