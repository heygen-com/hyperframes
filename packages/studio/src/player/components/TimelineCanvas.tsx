import { Fragment, memo, type ReactNode } from "react";
import { BeatStrip, BeatBackgroundLines } from "./BeatStrip";
import { TimelineClip } from "./TimelineClip";
import { TimelineClipDiamonds } from "./TimelineClipDiamonds";
import { TimelineRuler } from "./TimelineRuler";
import type { MusicBeatAnalysis } from "@hyperframes/core/beats";
import { PlayheadIndicator } from "./PlayheadIndicator";
import {
  getTimelineEditCapabilities,
  resolveBlockedTimelineEditIntent,
  type TimelineRangeSelection,
} from "./timelineEditing";
import { getRenderedTimelineElement, type TimelineTheme } from "./timelineTheme";
import { GUTTER, TRACK_H, CLIP_Y, CLIP_HANDLE_W } from "./timelineLayout";
import {
  usePlayerStore,
  type TimelineElement,
  type KeyframeCacheEntry,
} from "../store/playerStore";
import type { DraggedClipState, ResizingClipState, BlockedClipState } from "./useTimelineClipDrag";
import type { TrackVisualStyle } from "./timelineIcons";
import type { StackingTimelineLayer, TimelineLayerId } from "./timelineTrackOrder";
import { STUDIO_KEYFRAMES_ENABLED } from "../../components/editor/manualEditingAvailability";
import { SPLIT_BOUNDARY_EPSILON_S } from "../../utils/timelineElementSplit";
import { useTimelineEditContextOptional } from "../../contexts/TimelineEditContext";
import { isMusicTrack } from "../../utils/timelineInspector";
import { TimelineLayerGutter } from "./TimelineLayerGutter";
import {
  shouldShowTimelineLayerGroupHeader,
  TimelineLayerGroupHeader,
} from "./TimelineLayerGroupHeader";
import { resolveTimelineDropIndicator } from "./timelineDropIndicator";
import { TimelineDropInsertionLine } from "./TimelineDropInsertionLine";
import { TimelineDragGhost } from "./TimelineDragGhost";
import { TimelineSelectionOverlays } from "./TimelineSelectionOverlays";
import type { TimelineMarqueeOverlayRect } from "./useTimelineMarqueeSelection";

function ClipLintDot({ element }: { element: TimelineElement }) {
  const lint = usePlayerStore((s) => s.lintFindingsByElement.get(element.key ?? element.id));
  if (!lint || lint.count === 0) return null;
  return (
    <span
      className="absolute w-1.5 h-1.5 rounded-full bg-amber-400"
      style={{ top: 7, right: 7 }}
      title={lint.messages.join("\n")}
    />
  );
}

interface TimelineCanvasProps {
  major: number[];
  minor: number[];
  pps: number;
  trackContentWidth: number;
  totalH: number;
  effectiveDuration: number;
  majorTickInterval: number;
  rangeSelection: TimelineRangeSelection | null;
  marqueeRect: TimelineMarqueeOverlayRect | null;
  theme: TimelineTheme;
  displayTrackOrder: TimelineLayerId[];
  trackOrder: TimelineLayerId[];
  tracks: StackingTimelineLayer[];
  trackStyles: Map<TimelineLayerId, TrackVisualStyle>;
  selectedElementId: string | null;
  hoveredClip: string | null;
  draggedClip: DraggedClipState | null;
  resizingClip: ResizingClipState | null;
  blockedClipRef: React.RefObject<BlockedClipState | null>;
  suppressClickRef: React.RefObject<boolean>;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  renderClipContent?: (
    element: TimelineElement,
    style: { clip: string; label: string },
  ) => ReactNode;
  renderClipOverlay?: (element: TimelineElement) => ReactNode;
  playheadRef: React.RefObject<HTMLDivElement | null>;
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

export const TimelineCanvas = memo(function TimelineCanvas({
  major,
  minor,
  pps,
  trackContentWidth,
  totalH,
  effectiveDuration,
  majorTickInterval,
  rangeSelection,
  marqueeRect,
  theme,
  displayTrackOrder,
  trackOrder,
  tracks,
  trackStyles,
  selectedElementId,
  hoveredClip,
  draggedClip,
  resizingClip,
  blockedClipRef,
  suppressClickRef,
  scrollRef,
  renderClipContent,
  renderClipOverlay,
  playheadRef,
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
}: TimelineCanvasProps) {
  const {
    onResizeElement,
    onMoveElement,
    onToggleTrackHidden,
    onToggleElementHidden,
    onRazorSplit,
    onRazorSplitAll,
  } = useTimelineEditContextOptional();
  const beatDragging = usePlayerStore((s) => s.beatDragging);
  const selectedElementIds = usePlayerStore((s) => s.selectedElementIds);
  const activeSnapGuideTime = draggedClip?.started
    ? (draggedClip.snapBeatTime ?? draggedClip.snapGuideTime)
    : resizingClip?.started
      ? resizingClip.snapGuideTime
      : null;
  const draggedElement = draggedClip?.element ?? null;
  const activeDraggedElement =
    draggedClip?.started === true && draggedElement
      ? getRenderedTimelineElement({
          element: draggedElement,
          draggedElementId: draggedElement.key ?? draggedElement.id,
          previewStart: draggedClip.previewStart,
          previewTrack: draggedClip.previewTrack,
        })
      : null;
  const activeDraggedPosition =
    draggedClip?.started === true && activeDraggedElement && scrollRef.current
      ? {
          left:
            draggedClip.pointerClientX -
            scrollRef.current.getBoundingClientRect().left +
            scrollRef.current.scrollLeft -
            draggedClip.pointerOffsetX,
          top:
            draggedClip.pointerClientY -
            scrollRef.current.getBoundingClientRect().top +
            scrollRef.current.scrollTop -
            draggedClip.pointerOffsetY,
        }
      : null;

  const renderClipChildren = (element: TimelineElement, clipStyle: TrackVisualStyle) => (
    <>
      {renderClipOverlay?.(element)}
      {!renderClipContent && <ClipLintDot element={element} />}
      {renderClipContent && (
        <div className="absolute inset-0 overflow-hidden">
          {renderClipContent(element, clipStyle)}
        </div>
      )}
    </>
  );
  const activeDropPlacement =
    draggedClip?.started === true ? (draggedClip.previewStackingReorder?.placement ?? null) : null;

  return (
    // minWidth:100% makes the lanes and ruler fill the panel when the composition
    // is narrower than the viewport (zoomed out); content stays in time coords.
    <div
      className="relative"
      style={{ height: totalH, width: GUTTER + trackContentWidth, minWidth: "100%" }}
    >
      <TimelineRuler
        major={major}
        minor={minor}
        pps={pps}
        trackContentWidth={trackContentWidth}
        totalH={totalH}
        effectiveDuration={effectiveDuration}
        majorTickInterval={majorTickInterval}
        theme={theme}
        beatAnalysis={beatAnalysis}
      />

      {
        // fallow-ignore-next-line complexity
        displayTrackOrder.map((layerId, rowIndex) => {
          const layer = tracks.find((item) => item.id === layerId) ?? null;
          const previousLayerId = displayTrackOrder[rowIndex - 1];
          const previousLayer = previousLayerId
            ? (tracks.find((item) => item.id === previousLayerId) ?? null)
            : null;
          const els = layer?.elements ?? [];
          const ts = trackStyles.get(layerId) ?? getTrackStyle("");
          const isAudioLayer = layer?.kind === "audio";
          const isFirstAudioLayer = isAudioLayer && previousLayer?.kind !== "audio";
          const isPendingTrack =
            draggedClip?.started === true && !trackOrder.includes(layerId) && els.length === 0;
          const baseRowBackground = rowIndex % 2 === 0 ? theme.rowBackground : "#0D0E12";
          const dropIndicator = resolveTimelineDropIndicator({
            placement: activeDropPlacement,
            layerId,
            layerOrder: displayTrackOrder,
          });
          const rowBackground =
            dropIndicator?.kind === "onto"
              ? theme.clipBackgroundActive
              : isAudioLayer
                ? `linear-gradient(90deg, ${theme.gutterBackground} 0, ${baseRowBackground} 74px)`
                : baseRowBackground;
          const showGroupHeader = shouldShowTimelineLayerGroupHeader(
            layer?.contextKey ?? "",
            previousLayer?.contextKey ?? "",
          );
          const rowTrack = layer?.placementTrack ?? els[0]?.track ?? 0;
          // The beat-dot strip occupies the top of this track's lane (active track,
          // or the music track when nothing is selected). When shown, keyframe
          // diamonds shrink + drop to the bottom half so they don't collide with it.
          const beatStripOnTrack =
            (beatAnalysis?.beatTimes?.length ?? 0) >= 2 &&
            (selectedElementId
              ? els.some((e) => (e.key ?? e.id) === selectedElementId)
              : els.some(isMusicTrack));
          const isTrackHidden = els.length > 0 && els.every((element) => element.hidden === true);
          return (
            <Fragment key={layerId}>
              {showGroupHeader && layer && (
                <TimelineLayerGroupHeader
                  contextKey={layer.contextKey}
                  trackContentWidth={trackContentWidth}
                  theme={theme}
                  accentColor={ts.accent}
                />
              )}
              <div
                className="relative flex"
                style={{
                  height: TRACK_H,
                  background: rowBackground,
                  borderTop: isFirstAudioLayer ? `2px solid ${theme.rulerBorder}` : undefined,
                  borderBottom: `1px solid ${theme.rowBorder}`,
                  boxShadow:
                    dropIndicator?.kind === "onto" ? `inset 0 0 0 1px ${ts.accent}` : undefined,
                }}
              >
                <TimelineLayerGutter
                  isAudio={isAudioLayer}
                  isTrackHidden={isTrackHidden}
                  rowTrack={rowTrack}
                  theme={theme}
                  onToggleHidden={() => {
                    if (onToggleElementHidden && els.length > 0) {
                      for (const element of els) {
                        void onToggleElementHidden(element.key ?? element.id, !isTrackHidden);
                      }
                      return;
                    }
                    void onToggleTrackHidden?.(rowTrack, !isTrackHidden);
                  }}
                />
                <div
                  style={{
                    width: trackContentWidth,
                    opacity: isTrackHidden ? 0.35 : 1,
                    transition: "opacity 120ms ease",
                  }}
                  className="relative"
                >
                  {layer?.contextKey && (
                    <span
                      className="absolute bottom-0 top-0 pointer-events-none"
                      style={{
                        left: 0,
                        width: 2,
                        background: ts.accent,
                        opacity: 0.45,
                        zIndex: 2,
                      }}
                    />
                  )}
                  {dropIndicator?.kind === "line" && (
                    <TimelineDropInsertionLine edge={dropIndicator.edge} accentColor={ts.accent} />
                  )}
                  {/* Faint beat lines in every track's background (behind the clips);
                    the active snap target is highlighted. */}
                  <BeatBackgroundLines
                    beatTimes={beatAnalysis?.beatTimes}
                    beatStrengths={beatAnalysis?.beatStrengths}
                    pps={pps}
                    highlightTime={activeSnapGuideTime}
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
                        letterSpacing: 0,
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
                      const isSelected = selectedElementIds.has(elementKey);
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
                      return (
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
                          onResizeStart={(edge, e) => {
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
                              previewStart: el.start,
                              previewDuration: el.duration,
                              previewPlaybackStart: el.playbackStart,
                              snapGuideTime: null,
                              snapGuideKind: null,
                              started: false,
                            });
                          }}
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
                                previewLayerId: layerId,
                                previewLayerIndex: rowIndex,
                                previewStackingReorder: null,
                                snapBeatTime: null,
                                snapGuideTime: null,
                                snapGuideKind: null,
                                started: false,
                              });
                              syncClipDragAutoScroll(e.clientX, e.clientY);
                            }
                          }
                          onClick={(e) => {
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
                            const nextElement = isSelected ? null : el;
                            setSelectedElementId(nextElement ? elementKey : null);
                            onSelectElement?.(nextElement);
                          }}
                          onDoubleClick={(e) => {
                            e.stopPropagation();
                            if (suppressClickRef.current) return;
                            if (isComposition && onDrillDown) onDrillDown(el);
                          }}
                        >
                          {renderClipChildren(previewElement, clipStyle)}
                          {STUDIO_KEYFRAMES_ENABLED && keyframeCache?.get(elementKey) && (
                            <TimelineClipDiamonds
                              keyframesData={keyframeCache.get(elementKey)!}
                              clipWidthPx={Math.max(previewElement.duration * pps, 4)}
                              clipHeightPx={TRACK_H - 2 * CLIP_Y}
                              beatsActive={beatStripOnTrack}
                              beatTimes={beatAnalysis?.beatTimes}
                              clipStart={previewElement.start}
                              clipDurationSeconds={previewElement.duration}
                              pixelsPerSecond={pps}
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
                              onClickKeyframe={(pct) => onClickKeyframe?.(previewElement, pct)}
                              onShiftClickKeyframe={onShiftClickKeyframe}
                              onContextMenuKeyframe={onContextMenuKeyframe}
                              onMoveKeyframe={onMoveKeyframe}
                              suppressClickRef={suppressClickRef}
                            />
                          )}
                        </TimelineClip>
                      );
                    })
                  }
                </div>
              </div>
            </Fragment>
          );
        })
      }

      {activeDraggedElement && activeDraggedPosition && (
        <TimelineDragGhost
          element={activeDraggedElement}
          position={activeDraggedPosition}
          pps={pps}
          selectedElementId={selectedElementId}
          hasCustomContent={!!renderClipContent}
          theme={theme}
        >
          {renderClipChildren(activeDraggedElement, getTrackStyle(activeDraggedElement.tag))}
        </TimelineDragGhost>
      )}

      <TimelineSelectionOverlays
        rangeSelection={rangeSelection}
        marqueeRect={marqueeRect}
        pps={pps}
        accentColor={getTrackStyle("").accent}
      />

      {/* Playhead — hidden while dragging a beat so its guideline doesn't
          track the scrub and clutter the beat being moved. */}
      <div
        ref={playheadRef}
        className="absolute top-0 bottom-0 pointer-events-none"
        style={{
          left: `${GUTTER}px`,
          zIndex: 100,
          display: beatDragging ? "none" : undefined,
        }}
      >
        <PlayheadIndicator />
      </div>
    </div>
  );
});
