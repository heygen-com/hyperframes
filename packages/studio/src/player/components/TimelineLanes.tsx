import { Fragment, useId, useMemo } from "react";
import { BeatStrip, BeatBackgroundLines } from "./BeatStrip";
import { TimelineClip } from "./TimelineClip";
import { TimelineCompactDiamonds } from "./TimelineCompactDiamonds";
import { TimelinePropertyLanes } from "./TimelinePropertyLanes";
import { TimelineTrackHeader } from "./TimelineTrackHeader";
import { resolveTrackKeyframeClip } from "./useTimelineTrackLayout";
import { trackDisplayNumber, trackDisplaySuffix } from "./timelineTrackDisplay";
import { clipTimingStart } from "../../hooks/gsapShared";
import { getTimelineEditCapabilities, resolveBlockedTimelineEditIntent } from "./timelineEditing";
import { CLIP_Y, CLIP_HANDLE_W, TRACK_H } from "./timelineLayout";
import { usePlayerStore, type TimelineElement } from "../store/playerStore";
import {
  isMultiDragActive,
  isMultiDragPassenger,
  multiDragDeltaSeconds,
  type MultiDragPreviewInput,
  multiDragPassengerOffsetPx,
} from "./timelineMultiDragPreview";
import type { TimelineLaneBaseProps } from "./timelineLaneProps";
import type { TimelineEditCallbacks } from "./timelineCallbacks";
import { trackStudioKeyframeLaneExpand } from "../../telemetry/events";
import { SPLIT_BOUNDARY_EPSILON_S } from "../../utils/timelineElementSplit";
import { isAudioTimelineElement, isMusicTrack } from "../../utils/timelineInspector";
import { renderClipChildren } from "./timelineClipChildren";
import { TimelineTrackRow } from "./TimelineTrackRow";
import { isTimelineClipActive } from "./useTimelineActiveClips";
import { queryTimelineClipIndex } from "../lib/timelineClipIndex";
import { getTimelineElementIdentity } from "../lib/timelineElementHelpers";
import type { TimelineLogicalRow } from "./timelineKeyboardNavigation";
import { timelineClipFocusId } from "./timelineNavigationIdentity";
import { useTimelineKeyboardActor } from "./useTimelineKeyboardActor";

interface TimelineLanesProps extends TimelineLaneBaseProps {
  /** Live-derived by TimelineCanvas from {@link TimelineLaneBaseProps.draggedClip}. */
  draggedElement: TimelineElement | null;
  multiDragPreview: MultiDragPreviewInput | null;
  onToggleTrackHidden: TimelineEditCallbacks["onToggleTrackHidden"];
  onTogglePropertyGroupKeyframe: TimelineEditCallbacks["onTogglePropertyGroupKeyframe"];
  onResizeElement: TimelineEditCallbacks["onResizeElement"];
  onMoveElement: TimelineEditCallbacks["onMoveElement"];
  onRazorSplit: TimelineEditCallbacks["onRazorSplit"];
  onRazorSplitAll: TimelineEditCallbacks["onRazorSplitAll"];
}

export function TimelineLanes({
  pps,
  contentOrigin,
  contentGutter,
  trackContentWidth,
  theme,
  displayTrackOrder,
  rowGeometry,
  virtualRows,
  logicalRows,
  focusedTargetId,
  rowsVirtualized,
  clipIndex,
  renderTimeRange,
  pinnedClipIdentities,
  trackOrder,
  tracks,
  trackStyles,
  laneCounts,
  selectedElementId,
  selectedElementIds,
  hoveredClip,
  draggedClip,
  draggedElement,
  multiDragPreview,
  blockedClipRef,
  suppressClickRef,
  scrollRef,
  renderClipContent,
  renderClipOverlay,
  onDrillDown,
  onSelectElement,
  setHoveredClip,
  setShowPopover,
  setRangeSelection,
  setResizingClip,
  setDraggedClip,
  setSelectedElementId,
  shiftClickClipRef,
  getPreviewElement,
  getTrackStyle,
  keyframeCache,
  gsapAnimations,
  selectedKeyframes,
  currentTime,
  onSeek,
  onSelectSegment,
  onClickKeyframe,
  onShiftClickKeyframe,
  onContextMenuKeyframe,
  onMoveKeyframe,
  onContextMenuClip,
  onContextMenuLane,
  beatAnalysis,
  onToggleTrackHidden,
  onTogglePropertyGroupKeyframe,
  onResizeElement,
  onMoveElement,
  onRazorSplit,
  onRazorSplitAll,
}: TimelineLanesProps) {
  // ponytail: One per-instance namespace prevents aria-controls and aria-owns
  // from resolving into a second timeline that renders the same logical rows.
  const lanesIdPrefix = `timeline-lanes${useId().replaceAll(":", "")}`;
  const expandedClipIds = usePlayerStore((s) => s.expandedClipIds);
  const toggleClipExpanded = usePlayerStore((s) => s.toggleClipExpanded);
  const logicalRowsByTrack = useMemo(() => {
    const byTrack = new Map<number, TimelineLogicalRow[]>();
    for (const logicalRow of logicalRows) {
      const trackRows = byTrack.get(logicalRow.physicalTrackKey) ?? [];
      trackRows.push(logicalRow);
      byTrack.set(logicalRow.physicalTrackKey, trackRows);
    }
    return byTrack;
  }, [logicalRows]);
  const toggleClipExpandedTracked = (key: string) => {
    const willExpand = !expandedClipIds.has(key);
    trackStudioKeyframeLaneExpand({ expanded: willExpand });
    toggleClipExpanded(key);
  };
  const multiDragDelta =
    multiDragPreview && isMultiDragActive(multiDragPreview)
      ? multiDragDeltaSeconds(multiDragPreview)
      : 0;
  const actorWindows =
    rowsVirtualized && multiDragPreview && multiDragDelta !== 0
      ? [
          {
            range: {
              start: renderTimeRange.start - multiDragDelta,
              end: renderTimeRange.end - multiDragDelta,
            },
            identities: multiDragPreview.selectedKeys,
          },
        ]
      : [];
  const keyboard = useTimelineKeyboardActor({
    logicalRows,
    focusedTargetId,
    rowGeometry,
    scrollRef,
    onToggleRow: (row) => {
      if (row.elementId) toggleClipExpandedTracked(row.elementId);
    },
  });
  return (
    <div
      role="treegrid"
      aria-label="Timeline tracks"
      aria-rowcount={logicalRows.length}
      aria-colcount={2}
      onFocus={keyboard.onFocus}
      onKeyDown={keyboard.onKeyDown}
      className={rowsVirtualized ? "absolute inset-0" : undefined}
    >
      {
        // fallow-ignore-next-line complexity
        virtualRows.map(({ index: row, rowKey }) => {
          const trackNum = displayTrackOrder[row];
          if (trackNum === undefined) return null;
          const displayNumber = trackDisplayNumber(displayTrackOrder, trackNum);
          const trackLogicalRows = logicalRowsByTrack.get(trackNum) ?? [];
          const logicalRow = trackLogicalRows[0];
          if (!logicalRow) return null;
          const rowHeight = rowGeometry.getRowHeight(row);
          const els = tracks.find(([t]) => t === trackNum)?.[1] ?? [];
          const renderElements = rowsVirtualized
            ? queryTimelineClipIndex(
                clipIndex,
                trackNum,
                renderTimeRange,
                pinnedClipIdentities,
                actorWindows,
              )
            : els;
          const ts = trackStyles.get(trackNum) ?? getTrackStyle("");
          const isPendingTrack =
            draggedClip?.started === true && !trackOrder.includes(trackNum) && els.length === 0;
          // All lanes use the same uniform color — no alternating stripes.
          const rowBackground = theme.rowBackground;
          // Keep diamonds below the beat strip on the active/music track.
          const beatStripOnTrack =
            (beatAnalysis?.beatTimes?.length ?? 0) >= 2 &&
            (selectedElementId
              ? els.some((e) => (e.key ?? e.id) === selectedElementId)
              : els.some(isMusicTrack));
          const isTrackHidden = els.length > 0 && els.every((element) => element.hidden === true);
          const isAudioTrack = els.length > 0 && els.some(isAudioTimelineElement);
          // Only the selected/most-keyframed clip owns expanded lanes on a shared track.
          const keyframeClip = resolveTrackKeyframeClip(
            els,
            laneCounts,
            selectedElementId,
            selectedElementIds,
          );
          const keyframeClipKey = keyframeClip?.key ?? keyframeClip?.id;
          const keyframeClipExpanded =
            keyframeClipKey != null && expandedClipIds.has(keyframeClipKey);
          // Link the sticky caret to the canvas lanes with a stable display-row id.
          const lanesId = `${lanesIdPrefix}-track-${row}`;
          return (
            <TimelineTrackRow
              key={rowKey}
              index={row}
              rowKey={rowKey}
              logicalRow={logicalRow}
              propertyRows={trackLogicalRows.slice(1)}
              lanesId={lanesId}
              top={rowGeometry.getRowTop(row)}
              height={rowHeight}
              virtualized={rowsVirtualized}
              background={rowBackground}
              borderColor={theme.rowBorder}
              rovingTargetId={keyboard.rovingTargetId}
            >
              <TimelineTrackHeader
                trackNumber={trackNum}
                // What gets announced. `trackNum` is a fractional z-order sort
                // key, so it stays out of every label and in every callback.
                trackDisplayNumber={displayNumber}
                trackLabel={
                  els[0]?.label ??
                  els[0]?.domId ??
                  els[0]?.id ??
                  `Track${trackDisplaySuffix(displayNumber)}`
                }
                lanesId={lanesId}
                contentOrigin={contentOrigin}
                keyframeClip={keyframeClip}
                clipCount={els.length}
                isExpanded={keyframeClipExpanded}
                animations={keyframeClipKey ? (gsapAnimations.get(keyframeClipKey) ?? []) : []}
                currentTime={currentTime}
                isTrackHidden={isTrackHidden}
                isAudioTrack={isAudioTrack}
                theme={theme}
                onToggleClipExpanded={() => {
                  if (keyframeClipKey) {
                    toggleClipExpandedTracked(keyframeClipKey);
                  }
                }}
                onToggleTrackHidden={onToggleTrackHidden}
                onTogglePropertyGroupKeyframe={onTogglePropertyGroupKeyframe}
                onSeek={onSeek}
                rovingTargetId={keyboard.rovingTargetId}
              />
              <div
                role="gridcell"
                aria-colindex={2}
                style={{
                  width: trackContentWidth,
                  marginLeft: contentGutter, // room for a 0% diamond left of t=0
                  opacity: isTrackHidden ? 0.35 : 1,
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
                  onContextMenuLane(e, trackNum, time);
                }}
              >
                {/* Faint beat lines in every track's background (behind the clips);
                    the active move-snap target is highlighted. */}
                <BeatBackgroundLines
                  beatTimes={beatAnalysis?.beatTimes}
                  beatStrengths={beatAnalysis?.beatStrengths}
                  pps={pps}
                  highlightTime={
                    draggedClip?.started && draggedClip.snapType === "beat"
                      ? draggedClip.snapTime
                      : null
                  }
                  renderTimeRange={rowsVirtualized ? renderTimeRange : undefined}
                />
                {/* Beat dots on the active track (the one holding the selection),
                    falling back to the music track when nothing is selected. */}
                {beatStripOnTrack && (
                  <BeatStrip
                    beatTimes={beatAnalysis?.beatTimes}
                    beatStrengths={beatAnalysis?.beatStrengths}
                    pps={pps}
                    renderTimeRange={rowsVirtualized ? renderTimeRange : undefined}
                  />
                )}
                {isPendingTrack && (
                  <div
                    className="absolute inset-0 flex items-center"
                    style={{
                      paddingLeft: 16,
                      color: ts.label,
                      fontSize: 11,
                      letterSpacing: "0.06em",
                      textTransform: "uppercase",
                      opacity: 0.5,
                    }}
                  >
                    New track
                  </div>
                )}
                {
                  // fallow-ignore-next-line complexity
                  renderElements.map((el) => {
                    const clipStyle = getTrackStyle(el.tag);
                    const elementKey = getTimelineElementIdentity(el);
                    // Only the track's active keyframe clip shows expanded lanes;
                    // other clips (incl. siblings on a shared track) show compact
                    // diamonds on their own bar instead.
                    const isTrackKeyframeClip = elementKey === keyframeClipKey;
                    const showsLanes = isTrackKeyframeClip && keyframeClipExpanded;
                    const capabilities = getTimelineEditCapabilities(el);
                    const isSelected =
                      selectedElementId === elementKey || selectedElementIds.has(elementKey);
                    const isComposition = !!el.compositionSrc;
                    // The element identity is already unique per clip. Never fold in the map
                    // index, or a splice/reorder remounts every clip at/after the change.
                    const clipKey = elementKey;
                    const isDraggingClip =
                      draggedClip?.started === true &&
                      draggedElement != null &&
                      getTimelineElementIdentity(draggedElement) === elementKey;
                    if (isDraggingClip) return null;
                    const previewElement = getPreviewElement(el);
                    // Passenger of a live multi-drag: preserve the formation without changing
                    // the passenger's timeline data until the owning drag commits.
                    const isPassenger =
                      multiDragPreview != null && isMultiDragPassenger(clipKey, multiDragPreview);
                    const passengerOffsetPx = isPassenger
                      ? multiDragPassengerOffsetPx(clipKey, pps, multiDragPreview)
                      : 0;
                    const clip = (
                      <TimelineClip
                        key={clipKey}
                        onContextMenu={(e: React.MouseEvent) => {
                          e.preventDefault();
                          onContextMenuClip?.(e, el);
                        }}
                        el={previewElement}
                        pps={pps}
                        clipY={CLIP_Y}
                        clipHeight={showsLanes ? TRACK_H - 2 * CLIP_Y : undefined}
                        isSelected={isSelected}
                        isHovered={hoveredClip === clipKey}
                        isDragging={false}
                        isActive={isTimelineClipActive(previewElement, currentTime)}
                        hasCustomContent={!!renderClipContent}
                        capabilities={capabilities}
                        theme={theme}
                        isComposition={isComposition}
                        tabIndex={
                          keyboard.rovingTargetId === timelineClipFocusId(elementKey) ? 0 : -1
                        }
                        onHoverStart={() => setHoveredClip(clipKey)}
                        onHoverEnd={() => setHoveredClip(null)}
                        onResizeStart={
                          // fallow-ignore-next-line complexity
                          (edge, e) => {
                            if (e.button !== 0 || e.shiftKey || !onResizeElement) return;
                            if (edge === "start" && !capabilities.canTrimStart) return;
                            if (edge === "end" && !capabilities.canTrimEnd) return;
                            e.stopPropagation();
                            blockedClipRef.current = null;
                            setShowPopover(false);
                            setRangeSelection(null);
                            setResizingClip({
                              pointerId: e.pointerId,
                              element: el,
                              edge,
                              originClientX: e.clientX,
                              originScrollLeft: scrollRef.current?.scrollLeft ?? 0,
                              previewStart: el.start,
                              previewDuration: el.duration,
                              previewPlaybackStart: el.playbackStart,
                              started: false,
                            });
                          }
                        }
                        onPointerDown={
                          // fallow-ignore-next-line complexity
                          (e) => {
                            if (e.button !== 0) return;
                            if (usePlayerStore.getState().activeTool === "razor") return;
                            if (e.shiftKey) {
                              shiftClickClipRef.current = {
                                element: el,
                                anchorX: e.clientX,
                                anchorY: e.clientY,
                              };
                              return;
                            }
                            const target = e.currentTarget as HTMLElement;
                            const rect = target.getBoundingClientRect();
                            const blockedIntent = resolveBlockedTimelineEditIntent({
                              width: rect.width,
                              offsetX: e.clientX - rect.left,
                              handleWidth: CLIP_HANDLE_W,
                              capabilities,
                            });
                            if (
                              blockedIntent &&
                              ((blockedIntent === "move" && onMoveElement) ||
                                (blockedIntent !== "move" && onResizeElement))
                            ) {
                              blockedClipRef.current = {
                                pointerId: e.pointerId,
                                element: el,
                                intent: blockedIntent,
                                originClientX: e.clientX,
                                originClientY: e.clientY,
                                started: false,
                              };
                              return;
                            }
                            if (!onMoveElement || !capabilities.canMove) return;
                            blockedClipRef.current = null;
                            setShowPopover(false);
                            setRangeSelection(null);
                            setDraggedClip({
                              pointerId: e.pointerId,
                              element: el,
                              originClientX: e.clientX,
                              originClientY: e.clientY,
                              originScrollLeft: scrollRef.current?.scrollLeft ?? 0,
                              originScrollTop: scrollRef.current?.scrollTop ?? 0,
                              pointerClientX: e.clientX,
                              pointerClientY: e.clientY,
                              pointerOffsetX: e.clientX - rect.left,
                              pointerOffsetY: e.clientY - rect.top,
                              previewStart: el.start,
                              previewTrack: el.track,
                              desiredTrack: el.track,
                              insertRow: null,
                              snapTime: null,
                              snapType: null,
                              started: false,
                            });
                          }
                        }
                        onClick={
                          // fallow-ignore-next-line complexity
                          (e) => {
                            e.stopPropagation();
                            if (suppressClickRef.current) return;
                            const { activeTool } = usePlayerStore.getState();
                            if (activeTool === "razor" && onRazorSplit) {
                              const clipRect = (
                                e.currentTarget as HTMLElement
                              ).getBoundingClientRect();
                              const clickOffsetX = e.clientX - clipRect.left;
                              const splitTime = previewElement.start + clickOffsetX / pps;
                              const clampedTime = Math.max(
                                previewElement.start + SPLIT_BOUNDARY_EPSILON_S,
                                Math.min(
                                  previewElement.start +
                                    previewElement.duration -
                                    SPLIT_BOUNDARY_EPSILON_S,
                                  splitTime,
                                ),
                              );
                              if (e.shiftKey && onRazorSplitAll) {
                                onRazorSplitAll(clampedTime);
                              } else {
                                onRazorSplit(el, clampedTime);
                              }
                              return;
                            }
                            // Plain click single-selects: drop any marquee multi-selection.
                            // Only a click on the PRIMARY selection toggles it off — a click
                            // on a marquee-selected clip narrows the selection to that clip.
                            const hadMultiSelection = selectedElementIds.size > 0;
                            usePlayerStore.getState().clearSelectedElementIds();
                            const nextElement =
                              selectedElementId === elementKey && !hadMultiSelection ? null : el;
                            setSelectedElementId(nextElement ? elementKey : null);
                            onSelectElement?.(nextElement);
                          }
                        }
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          if (suppressClickRef.current) return;
                          if (isComposition && onDrillDown) onDrillDown(el);
                        }}
                      >
                        {renderClipChildren(
                          previewElement,
                          clipStyle,
                          renderClipContent,
                          renderClipOverlay,
                        )}
                      </TimelineClip>
                    );
                    const compactKeyframes = keyframeCache?.get(elementKey);
                    const compactDiamonds = !showsLanes && compactKeyframes && (
                      <TimelineCompactDiamonds
                        key={`${clipKey}-diamonds`}
                        element={previewElement}
                        elementId={elementKey}
                        keyframesData={compactKeyframes}
                        pixelsPerSecond={pps}
                        rowHeight={rowHeight}
                        beatsActive={beatStripOnTrack}
                        accentColor={clipStyle.accent}
                        isSelected={isSelected}
                        currentTime={currentTime}
                        selectedKeyframes={selectedKeyframes}
                        rovingTargetId={keyboard.rovingTargetId}
                        onClickKeyframe={onClickKeyframe}
                        onShiftClickKeyframe={onShiftClickKeyframe}
                        onContextMenuKeyframe={onContextMenuKeyframe}
                        onMoveKeyframe={onMoveKeyframe}
                        onSelectSegment={onSelectSegment}
                        suppressClickRef={suppressClickRef}
                      />
                    );
                    // Keep this shell mounted while collapsed so aria-controls stays valid
                    // and multi-drag cannot remount the subtree mid-gesture.
                    const propertyLanes = isTrackKeyframeClip && (
                      <TimelinePropertyLanes
                        key={`${clipKey}-property-lanes`}
                        id={lanesId}
                        animations={showsLanes ? (gsapAnimations.get(elementKey) ?? []) : []}
                        // clipTimingStart, not the raw start: an expanded sub-comp
                        // child's start is host-absolute while its tweens are
                        // local to its own file.
                        clipStart={clipTimingStart(previewElement)}
                        clipDuration={previewElement.duration}
                        clipLeftPx={previewElement.start * pps}
                        clipWidthPx={Math.max(previewElement.duration * pps, 4)}
                        accentColor={clipStyle.accent}
                        isSelected={isSelected}
                        currentPercentage={
                          previewElement.duration > 0
                            ? ((currentTime - previewElement.start) / previewElement.duration) * 100
                            : 0
                        }
                        elementId={elementKey}
                        selectedKeyframes={selectedKeyframes}
                        rovingTargetId={keyboard.rovingTargetId}
                        onSelectSegment={(target) => onSelectSegment?.(elementKey, target)}
                        onClickKeyframe={(target) => onClickKeyframe?.(previewElement, target)}
                        onShiftClickKeyframe={(target) =>
                          onShiftClickKeyframe?.(elementKey, target)
                        }
                        onContextMenuKeyframe={(e, target) =>
                          onContextMenuKeyframe?.(e, elementKey, target)
                        }
                        onMoveKeyframe={(target, toClipPercentage) =>
                          onMoveKeyframe?.(elementKey, target, toClipPercentage) ??
                          Promise.resolve(false)
                        }
                        suppressClickRef={suppressClickRef}
                      />
                    );
                    // One keyed child prevents window shifts from remounting focused clips.
                    if (!isPassenger) {
                      return (
                        <Fragment key={clipKey}>
                          {clip}
                          {compactDiamonds}
                          {propertyLanes}
                        </Fragment>
                      );
                    }
                    return (
                      <div
                        key={clipKey}
                        className="absolute inset-0"
                        style={{
                          transform: `translateX(${passengerOffsetPx}px)`,
                          opacity: 0.85,
                          zIndex: 20,
                          pointerEvents: "none",
                        }}
                      >
                        {clip}
                        {compactDiamonds}
                        {propertyLanes}
                      </div>
                    );
                  })
                }
              </div>
            </TimelineTrackRow>
          );
        })
      }
    </div>
  );
}
