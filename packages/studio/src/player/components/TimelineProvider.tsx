import {
  createContext,
  useContext,
  type ComponentProps,
  type CSSProperties,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  type RefCallback,
  type UIEvent,
} from "react";
import type { TimelineEmptyState } from "./TimelineEmptyState";
import type { TimelineProps } from "./TimelineTypes";
import type { TimelineRangeSelection } from "./timelineEditing";
import type { TimelineDropPlacement } from "./timelineCallbacks";
import type { Rect } from "../../utils/marqueeGeometry";
import type { ResizingClipState } from "./useTimelineClipDrag";
import type { TimelineLaneBaseProps } from "./timelineLaneProps";
import type { TimelineLaneGapStrips } from "./useTimelineGapHighlights";
import type { TimelineElement } from "../store/playerStore";
import type { TimelineTheme } from "./timelineTheme";
import type { TimelineEditCallbacks } from "./timelineCallbacks";
import type { KeyframeDiamondContextMenuState } from "./KeyframeDiamondContextMenu";
import { useTimelineProviderState } from "./useTimelineProviderState";

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

export type TimelineCanvasState = Omit<
  TimelineLaneBaseProps,
  "setRangeSelection" | "setResizingClip" | "setDraggedClip"
> & {
  major: number[];
  minor: number[];
  totalH: number;
  effectiveDuration: number;
  majorTickInterval: number;
  rangeSelection: TimelineRangeSelection | null;
  marqueeRect: Rect | null;
  resizingClip: ResizingClipState | null;
  isScrubbing: boolean;
  playheadRef: React.RefObject<HTMLDivElement | null>;
  laneGapStrips: TimelineLaneGapStrips[];
  dropPreview: TimelineDropPlacement | null;
  setRangeSelection: (value: TimelineRangeSelection | null) => void;
  setResizingClip: (value: ResizingClipState | null) => void;
  setDraggedClip: (value: TimelineLaneBaseProps["draggedClip"]) => void;
};

export interface ClipContextMenuState {
  x: number;
  y: number;
  element: TimelineElement;
  sessionEpoch: number;
}

export interface TrackGapContextMenuState {
  x: number;
  y: number;
  gapWidth: number | null;
  canCloseGap: boolean;
  canCloseAllGaps: boolean;
  hasAnyGaps: boolean;
}

export interface TimelineOverlaysState {
  elements: readonly TimelineElement[];
  elementsRef: { current: readonly TimelineElement[] };
  theme: TimelineTheme;
  showShortcutHint: boolean;
  showPopover: boolean;
  rangeSelection: TimelineRangeSelection | null;
  setShowPopover: (value: boolean) => void;
  setRangeSelection: (value: TimelineRangeSelection | null) => void;
  kfContextMenu: KeyframeDiamondContextMenuState | null;
  setKfContextMenu: (value: KeyframeDiamondContextMenuState | null) => void;
  onDeleteKeyframe: TimelineEditCallbacks["onDeleteKeyframe"];
  onDeleteAllKeyframes: TimelineEditCallbacks["onDeleteAllKeyframes"];
  onMoveKeyframeToPlayhead: TimelineEditCallbacks["onMoveKeyframeToPlayhead"];
  clipContextMenu: ClipContextMenuState | null;
  setClipContextMenu: (value: ClipContextMenuState | null) => void;
  currentTime: number;
  onSplitElement: TimelineEditCallbacks["onSplitElement"];
  pinZoomBeforeEdit: () => void;
  onDeleteElement?: (element: TimelineElement) => Promise<void> | void;
  onCopyClip?: () => boolean;
  onPasteClip?: () => Promise<void>;
  onDuplicateClip?: () => Promise<boolean>;
  canPasteClip?: () => boolean;
  gapContextMenu: TrackGapContextMenuState | null;
  onDismissGapContextMenu: () => void;
  onCloseTrackGap: () => void;
  onCloseAllTrackGaps: () => void;
  onHoverGapAction: (action: "close-gap" | "close-all" | null) => void;
}

export interface TimelineContainerProps {
  ref: RefCallback<HTMLDivElement>;
  "aria-label": string;
  "data-timeline-element-count": number;
  className: string;
  onMouseMove: (event: MouseEvent<HTMLDivElement>) => void;
  onMouseLeave: () => void;
  style: CSSProperties;
}

export interface TimelineViewportProps {
  ref: RefCallback<HTMLDivElement>;
  "data-timeline-scroll-viewport": boolean;
  "data-timeline-auto-scroll-left-inset": number;
  tabIndex: number;
  className: string;
  onScroll: (event: UIEvent<HTMLDivElement>) => void;
  onFocus: (event: React.FocusEvent<HTMLDivElement>) => void;
  onBlur: (event: React.FocusEvent<HTMLDivElement>) => void;
  onDragOver: (event: React.DragEvent<HTMLDivElement>) => void;
  onDragLeave: (event: React.DragEvent<HTMLDivElement>) => void;
  onDrop: (event: React.DragEvent<HTMLDivElement>) => void;
  onPointerDown: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerCancel: (event: PointerEvent<HTMLDivElement>) => void;
  onLostPointerCapture: (event: PointerEvent<HTMLDivElement>) => void;
}

export interface TimelineState {
  timelineReady: boolean;
  elements: readonly TimelineElement[];
  canvas: TimelineCanvasState;
  overlays: TimelineOverlaysState;
}

export interface TimelineActions {}

export interface TimelineMeta {
  renderClipContent: TimelineCanvasState["renderClipContent"];
  renderClipOverlay: TimelineCanvasState["renderClipOverlay"];
  emptyState: ComponentProps<typeof TimelineEmptyState>;
  containerProps: TimelineContainerProps;
  viewportProps: TimelineViewportProps;
  razorGuide: ReactNode;
}

export interface TimelineContextValue {
  state: TimelineState;
  actions: TimelineActions;
  meta: TimelineMeta;
}

const TimelineContext = createContext<TimelineContextValue | null>(null);

export function TimelineProvider({ children, ...props }: TimelineProps & { children: ReactNode }) {
  const value = useTimelineProviderState(props);
  return <TimelineContext.Provider value={value}>{children}</TimelineContext.Provider>;
}

export function TimelineContextProvider({
  value,
  children,
}: {
  value: TimelineContextValue;
  children: ReactNode;
}) {
  return <TimelineContext.Provider value={value}>{children}</TimelineContext.Provider>;
}

export function useTimelineContext(): TimelineContextValue {
  const value = useTimelineContextOptional();
  if (value === null) throw new Error("useTimelineContext must be used inside TimelineProvider");
  return value;
}

export function useTimelineContextOptional(): TimelineContextValue | null {
  return useContext(TimelineContext);
}
