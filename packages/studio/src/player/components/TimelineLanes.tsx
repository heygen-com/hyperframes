import { type ReactNode } from "react";
import { Eye, EyeSlash } from "@phosphor-icons/react";
import { BeatStrip, BeatBackgroundLines } from "./BeatStrip";
import { TimelineClip } from "./TimelineClip";
import { TimelineClipDiamonds } from "./TimelineClipDiamonds";
import type { MusicBeatAnalysis } from "@hyperframes/core/beats";
import { getTimelineEditCapabilities, resolveBlockedTimelineEditIntent } from "./timelineEditing";
import type { TimelineTheme } from "./timelineTheme";
import { GUTTER, TRACK_H, CLIP_Y, CLIP_HANDLE_W } from "./timelineLayout";
import {
  usePlayerStore,
  type TimelineElement,
  type KeyframeCacheEntry,
} from "../store/playerStore";
import type { DraggedClipState, ResizingClipState, BlockedClipState } from "./useTimelineClipDrag";
import {
  isMultiDragPassenger,
  multiDragPassengerOffsetPx,
  type MultiDragPreviewInput,
} from "./timelineMultiDragPreview";
import type { TrackVisualStyle } from "./timelineIcons";
import type { TimelineEditCallbacks } from "./timelineCallbacks";
import { STUDIO_KEYFRAMES_ENABLED } from "../../components/editor/manualEditingAvailability";
import { SPLIT_BOUNDARY_EPSILON_S } from "../../utils/timelineElementSplit";
import { isAudioTimelineElement, isMusicTrack } from "../../utils/timelineInspector";
import { Music } from "../../icons/SystemIcons";
import { renderClipChildren } from "./timelineClipChildren";

/**
 * Props shared by the scroll container ({@link TimelineCanvas}) and the lane
 * renderer below. TimelineCanvas passes these straight through via spread, so
 * they are declared once here and both prop types compose from this base — no
 * duplicated prop list.
 */
export interface TimelineLaneBaseProps {
  pps: number;
  trackContentWidth: number;
  theme: TimelineTheme;
  displayTrackOrder: number[];
  trackOrder: number[];
  tracks: [number, TimelineElement[]][];
  trackStyles: Map<number, TrackVisualStyle>;
  selectedElementId: string | null;
  selectedElementIds: Set<string>;
  hoveredClip: string | null;
  draggedClip: DraggedClipState | null;
  blockedClipRef: React.RefObject<BlockedClipState | null>;
  suppressClickRef: React.RefObject<boolean>;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  renderClipContent?: (
    element: TimelineElement,
    style: { clip: string; label: string },
  ) => ReactNode;
  renderClipOverlay?: (element: TimelineElement) => ReactNode;
  onDrillDown?: (element: TimelineElement) => void;
  onSelectElement?: (element: TimelineElement | null) => void;
  setHoveredClip: (key: string | null) => void;
  setShowPopover: (v: boolean) => void;
  setRangeSelection: (v: null) => void;
  setResizingClip: (v: ResizingClipState | null) => void;
  setDraggedClip: (v: DraggedClipState | null) => void;
  setSelectedElementId: (id: string | null) => void;
  syncClipDragAutoScroll: (x: number, y: number) => void;
  shiftClickClipRef: React.RefObject<{
    element: TimelineElement;
    anchorX: number;
    anchorY: number;
  } | null>;
  getPreviewElement: (element: TimelineElement) => TimelineElement;
  getTrackStyle: (tag: string) => TrackVisualStyle;
  keyframeCache?: Map<string, KeyframeCacheEntry>;
  selectedKeyframes: Set<string>;
  currentTime: number;
  onClickKeyframe?: (element: TimelineElement, percentage: number) => void;
  onShiftClickKeyframe?: (elementId: string, percentage: number) => void;
  onContextMenuKeyframe?: (e: React.MouseEvent, elementId: string, percentage: number) => void;
  onMoveKeyframe?: (
    elementId: string,
    fromClipPercentage: number,
    toClipPercentage: number,
  ) => void;
  onContextMenuClip?: (e: React.MouseEvent, element: TimelineElement) => void;
  beatAnalysis?: MusicBeatAnalysis | null;
}

interface TimelineLanesProps extends TimelineLaneBaseProps {
  /** Live-derived by TimelineCanvas from {@link TimelineLaneBaseProps.draggedClip}. */
  draggedElement: TimelineElement | null;
  multiDragPreview: MultiDragPreviewInput | null;
  onToggleTrackHidden: TimelineEditCallbacks["onToggleTrackHidden"];
  onResizeElement: TimelineEditCallbacks["onResizeElement"];
  onMoveElement: TimelineEditCallbacks["onMoveElement"];
  onRazorSplit: TimelineEditCallbacks["onRazorSplit"];
  onRazorSplitAll: TimelineEditCallbacks["onRazorSplitAll"];
}

export function TimelineLanes({
  pps,
  trackContentWidth,
  theme,
  displayTrackOrder,
  trackOrder,
  tracks,
  trackStyles,
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
  syncClipDragAutoScroll,
  shiftClickClipRef,
  getPreviewElement,
  getTrackStyle,
  keyframeCache,
  selectedKeyframes,
  currentTime,
  onClickKeyframe,
  onShiftClickKeyframe,
  onContextMenuKeyframe,
  onMoveKeyframe,
  onContextMenuClip,
  beatAnalysis,
  onToggleTrackHidden,
  onResizeElement,
  onMoveElement,
  onRazorSplit,
  onRazorSplitAll,
}: TimelineLanesProps) {
  return (
    <>
      {
        // NOTE (deliberate no-virtualization): lanes and their clips render via a
        // plain `.map()` inside the scroll container rather than a windowing/virtualized
        // list. NLE clip counts are small (dozens to low hundreds), so the DOM cost is
        // bounded and virtualization's complexity isn't worth it. TODO: revisit and swap
        // in a virtualizer if editorial workflows ever push very high clip counts.
        // fallow-ignore-next-line complexity
        displayTrackOrder.map((trackNum) => {
          const els = tracks.find(([t]) => t === trackNum)?.[1] ?? [];
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
          return (
            <div
              key={trackNum}
              className="relative flex"
              style={{
                height: TRACK_H,
                background: rowBackground,
                borderBottom: `1px solid ${theme.rowBorder}`,
              }}
            >
              <div
                className="sticky left-0 z-[12] flex-shrink-0 flex flex-col items-center justify-center gap-0.5"
                style={{
                  width: GUTTER,
                  background: theme.gutterBackground,
                  borderRight: `1px solid ${theme.gutterBorder}`,
                }}
              >
                {isAudioTrack && (
                  <Music size={12} weight="fill" aria-hidden="true" className="text-white/35" />
                )}
                <button
                  type="button"
                  aria-label={isTrackHidden ? `Show track ${trackNum}` : `Hide track ${trackNum}`}
                  title={isTrackHidden ? `Show track ${trackNum}` : `Hide track ${trackNum}`}
                  className={`flex h-6 w-6 items-center justify-center rounded border-0 bg-transparent p-0 transition-colors focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-[-1px] focus-visible:outline-[#3CE6AC] ${
                    isTrackHidden
                      ? "text-[#3CE6AC] hover:text-white"
                      : "text-white/35 hover:text-white/75"
                  }`}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    void onToggleTrackHidden?.(trackNum, !isTrackHidden);
                  }}
                >
                  {isTrackHidden ? (
                    <EyeSlash size={14} weight="bold" aria-hidden="true" />
                  ) : (
                    <Eye size={14} weight="bold" aria-hidden="true" />
                  )}
                </button>
              </div>
              <div
                style={{
                  width: trackContentWidth,
                  opacity: isTrackHidden ? 0.35 : 1,
                  transition: "opacity 120ms ease",
                }}
                className="relative"
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
                />
                {/* Beat dots on the active track (the one holding the selection),
                    falling back to the music track when nothing is selected. */}
                {beatStripOnTrack && (
                  <BeatStrip
                    beatTimes={beatAnalysis?.beatTimes}
                    beatStrengths={beatAnalysis?.beatStrengths}
                    pps={pps}
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
                  els.map((el) => {
                    const clipStyle = getTrackStyle(el.tag);
                    const elementKey = el.key ?? el.id;
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
                        isSelected={isSelected}
                        isHovered={hoveredClip === clipKey}
                        isDragging={false}
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
                            syncClipDragAutoScroll(e.clientX, e.clientY);
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
                        {STUDIO_KEYFRAMES_ENABLED && keyframeCache?.get(elementKey) && (
                          <TimelineClipDiamonds
                            keyframesData={keyframeCache.get(elementKey)!}
                            clipWidthPx={Math.max(previewElement.duration * pps, 4)}
                            clipHeightPx={TRACK_H - 2 * CLIP_Y}
                            beatsActive={beatStripOnTrack}
                            accentColor={clipStyle.accent}
                            isSelected={isSelected}
                            currentPercentage={
                              previewElement.duration > 0
                                ? ((currentTime - previewElement.start) / previewElement.duration) *
                                  100
                                : 0
                            }
                            elementId={elementKey}
                            selectedKeyframes={selectedKeyframes}
                            onClickKeyframe={(pct) => onClickKeyframe?.(previewElement, pct)}
                            onShiftClickKeyframe={onShiftClickKeyframe}
                            onContextMenuKeyframe={onContextMenuKeyframe}
                            onMoveKeyframe={onMoveKeyframe}
                            suppressClickRef={suppressClickRef}
                          />
                        )}
                      </TimelineClip>
                    );
                    if (!isPassenger) return clip;
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
                      </div>
                    );
                  })
                }
              </div>
            </div>
          );
        })
      }
    </>
  );
}
