import type { GsapAnimation } from "@hyperframes/core/gsap-parser";
import type { MusicBeatAnalysis } from "@hyperframes/core/beats";
import type { ReactNode } from "react";
import type { TimelineKeyframeTarget } from "./timelineKeyframeIdentity";
import type { TimelineTheme } from "./timelineTheme";
import type { BlockedClipState, DraggedClipState, ResizingClipState } from "./useTimelineClipDrag";
import type { TrackVisualStyle } from "./timelineIcons";
import type { KeyframeCacheEntry, TimelineElement } from "../store/playerStore";

/** Props shared by TimelineCanvas and its lane renderer. */
export interface TimelineLaneBaseProps {
  pps: number;
  contentOrigin: number;
  contentGutter: number;
  trackContentWidth: number;
  theme: TimelineTheme;
  displayTrackOrder: number[];
  rowHeights: readonly number[];
  trackOrder: number[];
  tracks: [number, TimelineElement[]][];
  trackStyles: Map<number, TrackVisualStyle>;
  laneCounts: ReadonlyMap<string, number>;
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
  setShowPopover: (value: boolean) => void;
  setRangeSelection: (value: null) => void;
  setResizingClip: (value: ResizingClipState | null) => void;
  setDraggedClip: (value: DraggedClipState | null) => void;
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
