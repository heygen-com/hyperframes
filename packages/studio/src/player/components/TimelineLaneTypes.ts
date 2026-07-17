import type { GsapAnimation } from "@hyperframes/core/gsap-parser";
import type { MusicBeatAnalysis } from "@hyperframes/core/beats";
import type { ReactNode, RefObject } from "react";
import type { KeyframeCacheEntry, TimelineElement } from "../store/playerStore";
import type { TimelineClipIndex, TimelineTimeRange } from "../lib/timelineClipIndex";
import type { TrackVisualStyle } from "./timelineIcons";
import type { TimelineKeyframeTarget } from "./timelineKeyframeIdentity";
import type { TimelineRowGeometry } from "./timelineLayout";
import type { TimelineClipRenderContext } from "./TimelineTypes";
import type { BlockedClipState, DraggedClipState, ResizingClipState } from "./useTimelineClipDrag";
import type { TimelineVirtualRow } from "./useTimelineVirtualRows";
import type { TimelineTheme } from "./timelineTheme";

/** Props shared by TimelineCanvas and its lane renderer. */
export interface TimelineLaneBaseProps {
  pps: number;
  contentOrigin: number;
  contentGutter: number;
  trackContentWidth: number;
  theme: TimelineTheme;
  displayTrackOrder: number[];
  rowHeights: readonly number[];
  rowGeometry: TimelineRowGeometry;
  virtualRows: readonly TimelineVirtualRow[];
  rowsVirtualized: boolean;
  clipIndex: TimelineClipIndex;
  renderTimeRange: TimelineTimeRange;
  visibleTimeRange: TimelineTimeRange;
  pinnedClipIdentities: ReadonlySet<string>;
  trackOrder: number[];
  tracks: [number, TimelineElement[]][];
  trackStyles: Map<number, TrackVisualStyle>;
  laneCounts: ReadonlyMap<string, number>;
  selectedElementId: string | null;
  selectedElementIds: Set<string>;
  hoveredClip: string | null;
  draggedClip: DraggedClipState | null;
  blockedClipRef: RefObject<BlockedClipState | null>;
  suppressClickRef: RefObject<boolean>;
  scrollRef: RefObject<HTMLDivElement | null>;
  renderClipContent?: (
    element: TimelineElement,
    style: { clip: string; label: string },
    context: TimelineClipRenderContext,
  ) => ReactNode;
  renderClipOverlay?: (element: TimelineElement) => ReactNode;
  onDrillDown?: (element: TimelineElement) => void;
  onSelectElement?: (element: TimelineElement | null) => void;
  onDeleteElement?: (element: TimelineElement) => Promise<void> | void;
  setHoveredClip: (key: string | null) => void;
  setShowPopover: (value: boolean) => void;
  setRangeSelection: (value: null) => void;
  setResizingClip: (value: ResizingClipState | null) => void;
  setDraggedClip: (value: DraggedClipState | null) => void;
  setSelectedElementId: (id: string | null) => void;
  shiftClickClipRef: RefObject<{
    element: TimelineElement;
    anchorX: number;
    anchorY: number;
  } | null>;
  getPreviewElement: (element: TimelineElement) => TimelineElement;
  getTrackStyle: (tag: string) => TrackVisualStyle;
  keyframeCache?: Map<string, KeyframeCacheEntry>;
  gsapAnimations: Map<string, GsapAnimation[]>;
  selectedKeyframes: Set<string>;
  currentTime: number;
  onSeek?: (time: number) => void;
  onSelectSegment?: (elementId: string, target: TimelineKeyframeTarget) => void;
  onClickKeyframe?: (element: TimelineElement, target: TimelineKeyframeTarget) => void;
  onShiftClickKeyframe?: (elementId: string, target: TimelineKeyframeTarget) => void;
  onContextMenuKeyframe?: (
    event: React.MouseEvent,
    elementId: string,
    target: TimelineKeyframeTarget,
  ) => void;
  onMoveKeyframe?: (
    elementId: string,
    fromClipPercentage: number,
    toClipPercentage: number,
    propertyGroup?: string,
    tweenPercentage?: number,
    animationId?: string,
  ) => Promise<boolean>;
  onContextMenuClip?: (event: React.MouseEvent, element: TimelineElement) => void;
  onContextMenuLane?: (event: React.MouseEvent, track: number, time: number) => void;
  beatAnalysis?: MusicBeatAnalysis | null;
}
