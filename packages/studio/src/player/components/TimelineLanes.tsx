import { BeatStrip, BeatBackgroundLines } from "./BeatStrip";
import { TimelineClip } from "./TimelineClip";
import { TimelineClipDiamonds } from "./TimelineClipDiamonds";
import { TimelinePropertyLanes } from "./TimelinePropertyLanes";
import { TimelineTrackHeader } from "./TimelineTrackHeader";
import { resolveTrackKeyframeClip } from "./useTimelineTrackLayout";
import { getTimelineEditCapabilities, resolveBlockedTimelineEditIntent } from "./timelineEditing";
import { CLIP_Y, CLIP_HANDLE_W, TRACK_H } from "./timelineLayout";
import { usePlayerStore, type TimelineElement } from "../store/playerStore";
import {
  isMultiDragPassenger,
  multiDragPassengerOffsetPx,
  type MultiDragPreviewInput,
} from "./timelineMultiDragPreview";
import type { TimelineEditCallbacks } from "./timelineCallbacks";
import { STUDIO_KEYFRAMES_ENABLED } from "../../components/editor/manualEditingAvailability";
import { trackStudioKeyframeLaneExpand } from "../../telemetry/events";
import { SPLIT_BOUNDARY_EPSILON_S } from "../../utils/timelineElementSplit";
import { isAudioTimelineElement, isMusicTrack } from "../../utils/timelineInspector";
import { renderClipChildren } from "./timelineClipChildren";
import type { TimelineLaneBaseProps } from "./TimelineLaneTypes";
import { TimelineTrackRow } from "./TimelineTrackRow";
import { isTimelineClipActive } from "./useTimelineActiveClips";
import { queryTimelineClipIndex } from "../lib/timelineClipIndex";

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
  const expandedClipIds = usePlayerStore((s) => s.expandedClipIds);
  const toggleClipExpanded = usePlayerStore((s) => s.toggleClipExpanded);
  const toggleClipExpandedTracked = (key: string) => {
    const willExpand = !expandedClipIds.has(key);
    trackStudioKeyframeLaneExpand({ expanded: willExpand });
    toggleClipExpanded(key);
  };
  return (
    <div
      role="list"
      aria-label="Timeline tracks"
      className={rowsVirtualized ? "absolute inset-0" : undefined}
    >
      {
        // fallow-ignore-next-line complexity
        virtualRows.map(({ index: row, rowKey }) => {
          const trackNum = displayTrackOrder[row];
          if (trackNum === undefined) return null;
          const rowHeight = rowGeometry.getRowHeight(row);
          const els = tracks.find(([t]) => t === trackNum)?.[1] ?? [];
          const indexedRenderElements = rowsVirtualized
            ? queryTimelineClipIndex(clipIndex, trackNum, renderTimeRange, pinnedClipIdentities)
            : els;
          const indexedRenderSet = new Set(indexedRenderElements);
          const renderElements = rowsVirtualized
            ? els.filter((element) => {
                if (indexedRenderSet.has(element)) return true;
                if (
                  !multiDragPreview ||
                  !isMultiDragPassenger(element.key ?? element.id, multiDragPreview)
                ) {
                  return false;
                }
                const previewStart =
                  element.start +
                  multiDragPassengerOffsetPx(element.key ?? element.id, pps, multiDragPreview) /
                    pps;
                const previewEnd = previewStart + Math.max(0, element.duration);
                return previewEnd <= previewStart
                  ? previewStart >= renderTimeRange.start && previewStart < renderTimeRange.end
                  : previewStart < renderTimeRange.end && previewEnd > renderTimeRange.start;
              })
            : els;
          const ts = trackStyles.get(trackNum) ?? getTrackStyle("");
          const isPendingTrack =
            draggedClip?.started === true && !trackOrder.includes(trackNum) && els.length === 0;
          // All lanes use the same uniform color — no alternating stripes.
          const rowBackground = theme.rowBackground;
          // The beat-dot strip occupies the top of this track's lane (active track,
          // or the music track when nothing is selected). When shown, keyframe
          // diamonds shrink + drop to the bottom half so they don't collide with it.
          const beatStripOnTrack =
            (beatAnalysis?.beatTimes?.length ?? 0) >= 2 &&
            (selectedElementId
              ? els.some((e) => (e.key ?? e.id) === selectedElementId)
              : els.some(isMusicTrack));
          const isTrackHidden = els.length > 0 && els.every((element) => element.hidden === true);
          const isAudioTrack = els.length > 0 && els.some(isAudioTimelineElement);
          // The one keyframed element this track shows lanes for (selected, else
          // most lanes). A track can hold several elements; scoping to one keeps
          // their keyframes from cramming into a single row.
          const keyframeClip = STUDIO_KEYFRAMES_ENABLED
            ? resolveTrackKeyframeClip(els, laneCounts, selectedElementId, selectedElementIds)
            : null;
          const keyframeClipKey = keyframeClip?.key ?? keyframeClip?.id;
          const keyframeClipExpanded =
            keyframeClipKey != null && expandedClipIds.has(keyframeClipKey);
          return (
            <TimelineTrackRow
              key={rowKey}
              index={row}
              rowKey={rowKey}
              rowCount={displayTrackOrder.length}
              top={rowGeometry.getRowTop(row)}
              height={rowHeight}
              virtualized={rowsVirtualized}
              background={rowBackground}
              borderColor={theme.rowBorder}
            >
              <TimelineTrackHeader
                trackNumber={trackNum}
                trackLabel={els[0]?.label ?? els[0]?.domId ?? els[0]?.id ?? `Track ${trackNum}`}
                contentOrigin={contentOrigin}
                keyframeClip={keyframeClip}
                isExpanded={keyframeClipExpanded}
                animations={keyframeClipKey ? (gsapAnimations.get(keyframeClipKey) ?? []) : []}
                currentTime={currentTime}
                isTrackHidden={isTrackHidden}
                isAudioTrack={isAudioTrack}
                isActive={
                  keyframeClipKey != null &&
                  (selectedElementId === keyframeClipKey || selectedElementIds.has(keyframeClipKey))
                }
                isHovered={keyframeClipKey != null && hoveredClip === keyframeClipKey}
                theme={theme}
                onToggleClipExpanded={() => {
                  if (keyframeClipKey) {
                    toggleClipExpandedTracked(keyframeClipKey);
                  }
                }}
                onToggleTrackHidden={onToggleTrackHidden}
                onTogglePropertyGroupKeyframe={onTogglePropertyGroupKeyframe}
                onSeek={onSeek}
              />
              <div
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
                    const elementKey = el.key ?? el.id;
                    // Only the track's active keyframe clip shows expanded lanes;
                    // other clips (incl. siblings on a shared track) show compact
                    // diamonds on their own bar instead.
                    const showsLanes =
                      STUDIO_KEYFRAMES_ENABLED &&
                      elementKey === keyframeClipKey &&
                      keyframeClipExpanded;
                    const capabilities = getTimelineEditCapabilities(el);
                    const isSelected =
                      selectedElementId === elementKey || selectedElementIds.has(elementKey);
                    const isComposition = !!el.compositionSrc;
                    // elementKey (el.key ?? el.id) is already unique per clip; do NOT
                    // fold in the map index, or a splice/reorder remounts every clip
                    // at/after the change (DOM flash, drag interruption).
                    const clipKey = elementKey;
                    const isDraggingClip =
                      draggedClip?.started === true &&
                      (draggedElement?.key ?? draggedElement?.id) === elementKey;
                    if (isDraggingClip) return null;
                    const previewElement = getPreviewElement(el);
                    // Passenger of a live multi-drag: slide by the SAME formation
                    // delta (the grabbed clip's group-clamped delta) via a
                    // compositor transform on a same-geometry wrapper (absolute
                    // inset-0 → identical offset parent, so the clip's own
                    // left/top are preserved), plus the ghost's elevated z/opacity.
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
                        {STUDIO_KEYFRAMES_ENABLED &&
                          !showsLanes &&
                          keyframeCache?.get(elementKey) && (
                            <TimelineClipDiamonds
                              keyframesData={keyframeCache.get(elementKey)!}
                              clipWidthPx={Math.max(previewElement.duration * pps, 4)}
                              clipHeightPx={rowHeight - 2 * CLIP_Y}
                              beatsActive={beatStripOnTrack}
                              accentColor={clipStyle.accent}
                              isSelected={isSelected}
                              currentPercentage={
                                previewElement.duration > 0
                                  ? ((currentTime - previewElement.start) /
                                      previewElement.duration) *
                                    100
                                  : 0
                              }
                              elementId={elementKey}
                              selectedKeyframes={selectedKeyframes}
                              onClickKeyframe={(pct) =>
                                onClickKeyframe?.(previewElement, { percentage: pct })
                              }
                              onShiftClickKeyframe={(elId, pct) =>
                                onShiftClickKeyframe?.(elId, { percentage: pct })
                              }
                              onContextMenuKeyframe={(e, elId, pct) =>
                                onContextMenuKeyframe?.(e, elId, { percentage: pct })
                              }
                              onMoveKeyframe={onMoveKeyframe}
                              onSelectSegment={onSelectSegment}
                              suppressClickRef={suppressClickRef}
                            />
                          )}
                      </TimelineClip>
                    );
                    const propertyLanes = showsLanes && (
                      <TimelinePropertyLanes
                        key={`${clipKey}-property-lanes`}
                        animations={gsapAnimations.get(elementKey) ?? []}
                        clipStart={previewElement.start}
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
                        onSelectSegment={(target) => onSelectSegment?.(elementKey, target)}
                        onClickKeyframe={(target) => onClickKeyframe?.(previewElement, target)}
                        onShiftClickKeyframe={(target) =>
                          onShiftClickKeyframe?.(elementKey, target)
                        }
                        onContextMenuKeyframe={(e, target) =>
                          onContextMenuKeyframe?.(e, elementKey, target)
                        }
                        onMoveKeyframe={(target, toClipPercentage) =>
                          onMoveKeyframe?.(
                            elementKey,
                            target.percentage,
                            toClipPercentage,
                            target.propertyGroup,
                            target.tweenPercentage,
                            target.animationId,
                          ) ?? Promise.resolve(false)
                        }
                        suppressClickRef={suppressClickRef}
                      />
                    );
                    if (!isPassenger) return [clip, propertyLanes];
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
