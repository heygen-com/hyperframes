import { useRef, useMemo, useCallback, useState, useEffect, memo, type ReactNode } from "react";
import {
  usePlayerStore,
  liveTime,
  type TimelineElement,
  type ZoomMode,
} from "../store/playerStore";
import { useMountEffect } from "../../hooks/useMountEffect";
import { formatTime } from "../lib/time";
import { TimelineClip } from "./TimelineClip";
import { EditPopover } from "./EditModal";
import {
  resolveTimelineAutoScroll,
  resolveTimelineMove,
  resolveTimelineResize,
} from "./timelineEditing";
import {
  defaultTimelineTheme,
  getRenderedTimelineElement,
  getTimelineTrackStyle,
  type TimelineTrackStyle,
  type TimelineTheme,
} from "./timelineTheme";
import { getTimelinePixelsPerSecond } from "./timelineZoom";

/* ── Layout ─────────────────────────────────────────────────────── */
const GUTTER = 32;
const TRACK_H = 72;
const RULER_H = 24;
const CLIP_Y = 3; // vertical inset inside track

interface TrackVisualStyle extends TimelineTrackStyle {
  icon: ReactNode;
}

/* ── Icons from Figma Motion Cut design system ── */
const ICON_BASE = "/icons/timeline";
function TimelineIcon({ src }: { src: string }) {
  return (
    <img
      src={src}
      alt=""
      width={12}
      height={12}
      style={{ filter: "brightness(0) invert(1)" }}
      draggable={false}
    />
  );
}
const IconCaptions = <TimelineIcon src={`${ICON_BASE}/captions.svg`} />;
const IconImage = <TimelineIcon src={`${ICON_BASE}/image.svg`} />;
const IconMusic = <TimelineIcon src={`${ICON_BASE}/music.svg`} />;
const IconText = <TimelineIcon src={`${ICON_BASE}/text.svg`} />;
const IconComposition = <TimelineIcon src={`${ICON_BASE}/composition.svg`} />;
const IconAudio = <TimelineIcon src={`${ICON_BASE}/audio.svg`} />;

const ICONS: Record<string, ReactNode> = {
  video: IconImage,
  audio: IconMusic,
  img: IconImage,
  div: IconComposition,
  span: IconCaptions,
  p: IconText,
  h1: IconText,
  section: IconComposition,
  sfx: IconAudio,
};

function getStyle(tag: string): TrackVisualStyle {
  const trackStyle = getTimelineTrackStyle(tag);
  const normalized = tag.toLowerCase();
  const icon =
    normalized.startsWith("h") && normalized.length === 2 && "123456".includes(normalized[1] ?? "")
      ? ICONS.h1
      : (ICONS[normalized] ?? IconComposition);
  return {
    ...trackStyle,
    icon,
  };
}

/* ── Tick Generation ────────────────────────────────────────────── */
export function generateTicks(duration: number): { major: number[]; minor: number[] } {
  if (duration <= 0 || !Number.isFinite(duration) || duration > 7200)
    return { major: [], minor: [] };
  const intervals = [0.5, 1, 2, 5, 10, 15, 30, 60];
  const target = duration / 6;
  const majorInterval = intervals.find((i) => i >= target) ?? 60;
  const minorInterval = Math.max(0.25, majorInterval / 2);
  const major: number[] = [];
  const minor: number[] = [];
  const maxTicks = 500; // Safety cap to prevent infinite loop
  for (
    let t = 0;
    t <= duration + 0.001 && major.length + minor.length < maxTicks;
    t += minorInterval
  ) {
    const rounded = Math.round(t * 100) / 100;
    const isMajor =
      Math.abs(rounded % majorInterval) < 0.01 ||
      Math.abs((rounded % majorInterval) - majorInterval) < 0.01;
    if (isMajor) major.push(rounded);
    else minor.push(rounded);
  }
  return { major, minor };
}

export function shouldAutoScrollTimeline(
  zoomMode: ZoomMode,
  scrollWidth: number,
  clientWidth: number,
): boolean {
  if (zoomMode === "fit") return false;
  if (!Number.isFinite(scrollWidth) || !Number.isFinite(clientWidth)) return false;
  return scrollWidth - clientWidth > 1;
}

export function getTimelineScrollLeftForZoomTransition(
  previousZoomMode: ZoomMode | null,
  nextZoomMode: ZoomMode,
  currentScrollLeft: number,
): number {
  if (previousZoomMode === "manual" && nextZoomMode === "fit") return 0;
  return currentScrollLeft;
}

export function getTimelinePlayheadLeft(time: number, pixelsPerSecond: number): number {
  if (!Number.isFinite(time) || !Number.isFinite(pixelsPerSecond)) return GUTTER;
  return GUTTER + Math.max(0, time) * Math.max(0, pixelsPerSecond);
}

/* ── Component ──────────────────────────────────────────────────── */
interface TimelineProps {
  /** Called when user seeks via ruler/track click or playhead drag */
  onSeek?: (time: number) => void;
  /** Called when user double-clicks a composition clip to drill into it */
  onDrillDown?: (element: import("../store/playerStore").TimelineElement) => void;
  /** Optional custom content renderer for clips (thumbnails, waveforms, etc.) */
  renderClipContent?: (
    element: import("../store/playerStore").TimelineElement,
    style: { clip: string; label: string },
  ) => ReactNode;
  /** Optional overlay renderer for clips (e.g. badges, cursors) */
  renderClipOverlay?: (element: import("../store/playerStore").TimelineElement) => ReactNode;
  /** Called when files are dropped onto the empty timeline */
  onFileDrop?: (files: File[]) => void;
  /** Persist a clip move back into source HTML */
  onMoveElement?: (
    element: import("../store/playerStore").TimelineElement,
    updates: Pick<import("../store/playerStore").TimelineElement, "start" | "track">,
  ) => Promise<void> | void;
  onResizeElement?: (
    element: import("../store/playerStore").TimelineElement,
    updates: Pick<
      import("../store/playerStore").TimelineElement,
      "start" | "duration" | "playbackStart"
    >,
  ) => Promise<void> | void;
  theme?: Partial<TimelineTheme>;
}

interface DraggedClipState {
  element: TimelineElement;
  originClientX: number;
  originClientY: number;
  originScrollLeft: number;
  originScrollTop: number;
  pointerClientX: number;
  pointerClientY: number;
  pointerOffsetX: number;
  pointerOffsetY: number;
  previewStart: number;
  previewTrack: number;
  started: boolean;
}

interface ResizingClipState {
  element: TimelineElement;
  edge: "start" | "end";
  originClientX: number;
  previewStart: number;
  previewDuration: number;
  previewPlaybackStart?: number;
  started: boolean;
}

export const Timeline = memo(function Timeline({
  onSeek,
  onDrillDown,
  renderClipContent,
  renderClipOverlay,
  onFileDrop,
  onMoveElement,
  onResizeElement,
  theme: themeOverrides,
}: TimelineProps = {}) {
  const theme = useMemo(() => ({ ...defaultTimelineTheme, ...themeOverrides }), [themeOverrides]);
  const elements = usePlayerStore((s) => s.elements);
  const duration = usePlayerStore((s) => s.duration);
  const timelineReady = usePlayerStore((s) => s.timelineReady);
  const selectedElementId = usePlayerStore((s) => s.selectedElementId);
  const setSelectedElementId = usePlayerStore((s) => s.setSelectedElementId);
  const updateElement = usePlayerStore((s) => s.updateElement);
  const currentTime = usePlayerStore((s) => s.currentTime);
  const zoomMode = usePlayerStore((s) => s.zoomMode);
  const manualZoomPercent = usePlayerStore((s) => s.manualZoomPercent);
  const playheadRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [hoveredClip, setHoveredClip] = useState<string | null>(null);
  const isDragging = useRef(false);
  // Range selection (Shift+drag)
  const [shiftHeld, setShiftHeld] = useState(false);
  useMountEffect(() => {
    const down = (e: KeyboardEvent) => e.key === "Shift" && setShiftHeld(true);
    const up = (e: KeyboardEvent) => e.key === "Shift" && setShiftHeld(false);
    const blur = () => setShiftHeld(false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  });
  const isRangeSelecting = useRef(false);
  const rangeAnchorTime = useRef(0);
  const [rangeSelection, setRangeSelection] = useState<{
    start: number;
    end: number;
    anchorX: number;
    anchorY: number;
  } | null>(null);
  const [draggedClip, setDraggedClip] = useState<DraggedClipState | null>(null);
  const draggedClipRef = useRef<DraggedClipState | null>(null);
  draggedClipRef.current = draggedClip;
  const [resizingClip, setResizingClip] = useState<ResizingClipState | null>(null);
  const resizingClipRef = useRef<ResizingClipState | null>(null);
  resizingClipRef.current = resizingClip;
  const onMoveElementRef = useRef(onMoveElement);
  onMoveElementRef.current = onMoveElement;
  const onResizeElementRef = useRef(onResizeElement);
  onResizeElementRef.current = onResizeElement;
  const suppressClickRef = useRef(false);
  const [showPopover, setShowPopover] = useState(false);
  const [viewportWidth, setViewportWidth] = useState(0);
  const roRef = useRef<ResizeObserver | null>(null);

  // Callback ref: sets up ResizeObserver when the DOM element actually mounts.
  // useMountEffect can't work here because the component returns null on first
  // render (timelineReady=false), so containerRef.current is null when the
  // effect fires and the ResizeObserver is never created.
  const setContainerRef = useCallback((el: HTMLDivElement | null) => {
    if (roRef.current) {
      roRef.current.disconnect();
      roRef.current = null;
    }
    containerRef.current = el;
    if (!el) return;
    setViewportWidth(el.clientWidth);
    roRef.current = new ResizeObserver(([entry]) => {
      setViewportWidth(entry.contentRect.width);
    });
    roRef.current.observe(el);
  }, []);

  // Clean up ResizeObserver on unmount
  useMountEffect(() => () => {
    roRef.current?.disconnect();
  });

  // Effective duration: max of store duration and the furthest element end.
  // processTimelineMessage updates elements but not duration, so elements can
  // extend beyond the store's duration — this ensures fit mode shows everything.
  const effectiveDuration = useMemo(() => {
    const safeDur = Number.isFinite(duration) ? duration : 0;
    if (elements.length === 0) return safeDur;
    const maxEnd = Math.max(...elements.map((el) => el.start + el.duration));
    const result = Math.max(safeDur, maxEnd);
    return Number.isFinite(result) ? result : safeDur;
  }, [elements, duration]);

  const tracks = useMemo(() => {
    const map = new Map<number, typeof elements>();
    for (const el of elements) {
      const list = map.get(el.track) ?? [];
      list.push(el);
      map.set(el.track, list);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a - b);
  }, [elements]);

  const trackStyles = useMemo(() => {
    const map = new Map<number, TrackVisualStyle>();
    for (const [trackNum, els] of tracks) {
      map.set(trackNum, getStyle(els[0]?.tag ?? ""));
    }
    return map;
  }, [tracks]);

  const trackOrder = useMemo(() => tracks.map(([trackNum]) => trackNum), [tracks]);
  const trackOrderRef = useRef(trackOrder);
  trackOrderRef.current = trackOrder;
  const displayTrackOrder = useMemo(() => {
    if (
      !draggedClip?.started ||
      trackOrder.length === 0 ||
      trackOrder.includes(draggedClip.previewTrack)
    ) {
      return trackOrder;
    }
    return [...trackOrder, draggedClip.previewTrack].sort((a, b) => a - b);
  }, [draggedClip, trackOrder]);

  // Calculate effective pixels per second
  // In fit mode, use clientWidth (excludes scrollbar) with a small padding
  const fitPps =
    viewportWidth > GUTTER && effectiveDuration > 0
      ? (viewportWidth - GUTTER - 2) / effectiveDuration
      : 100;
  const pps = getTimelinePixelsPerSecond(fitPps, zoomMode, manualZoomPercent);
  const trackContentWidth = Math.max(0, effectiveDuration * pps);
  const zoomModeRef = useRef(zoomMode);
  zoomModeRef.current = zoomMode;
  const previousZoomModeRef = useRef<ZoomMode | null>(zoomMode);

  const durationRef = useRef(effectiveDuration);
  durationRef.current = effectiveDuration;
  const ppsRef = useRef(pps);
  ppsRef.current = pps;
  const syncPlayheadPosition = useCallback((time: number) => {
    if (!playheadRef.current || durationRef.current <= 0) return;
    playheadRef.current.style.left = `${getTimelinePlayheadLeft(time, ppsRef.current)}px`;
  }, []);

  useEffect(() => {
    syncPlayheadPosition(currentTime);
  }, [currentTime, pps, syncPlayheadPosition]);

  useEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll) {
      previousZoomModeRef.current = zoomMode;
      return;
    }
    scroll.scrollLeft = getTimelineScrollLeftForZoomTransition(
      previousZoomModeRef.current,
      zoomMode,
      scroll.scrollLeft,
    );
    previousZoomModeRef.current = zoomMode;
  }, [zoomMode]);

  useMountEffect(() => {
    const unsub = liveTime.subscribe((t) => {
      const dur = durationRef.current;
      if (!playheadRef.current || dur <= 0) return;
      const playheadX = getTimelinePlayheadLeft(t, ppsRef.current);
      playheadRef.current.style.left = `${playheadX}px`;

      // Auto-scroll to follow playhead during playback or seeking
      const scroll = scrollRef.current;
      if (
        scroll &&
        !isDragging.current &&
        shouldAutoScrollTimeline(zoomModeRef.current, scroll.scrollWidth, scroll.clientWidth)
      ) {
        const visibleRight = scroll.scrollLeft + scroll.clientWidth;
        const visibleLeft = scroll.scrollLeft;
        const edgeMargin = scroll.clientWidth * 0.12;

        if (playheadX > visibleRight - edgeMargin) {
          // Playhead near right edge — page forward
          scroll.scrollLeft = playheadX - scroll.clientWidth * 0.15;
        } else if (playheadX < visibleLeft + GUTTER) {
          // Playhead before visible area (e.g. loop) — jump back
          scroll.scrollLeft = Math.max(0, playheadX - GUTTER);
        }
      }
    });
    return unsub;
  });

  const dragScrollRaf = useRef(0);
  const clipDragScrollRaf = useRef(0);
  const clipDragPointerRef = useRef<{ clientX: number; clientY: number } | null>(null);

  const updateDraggedClipPreview = useCallback(
    (drag: DraggedClipState, clientX: number, clientY: number) => {
      const scroll = scrollRef.current;
      const nextMove = resolveTimelineMove(
        {
          start: drag.element.start,
          track: drag.element.track,
          duration: drag.element.duration,
          originClientX: drag.originClientX,
          originClientY: drag.originClientY,
          originScrollLeft: drag.originScrollLeft,
          originScrollTop: drag.originScrollTop,
          currentScrollLeft: scroll?.scrollLeft ?? drag.originScrollLeft,
          currentScrollTop: scroll?.scrollTop ?? drag.originScrollTop,
          pixelsPerSecond: ppsRef.current,
          trackHeight: TRACK_H,
          maxStart: Math.max(0, durationRef.current - drag.element.duration),
          trackOrder: trackOrderRef.current,
        },
        clientX,
        clientY,
      );

      return {
        ...drag,
        started: true,
        pointerClientX: clientX,
        pointerClientY: clientY,
        previewStart: nextMove.start,
        previewTrack: nextMove.track,
      };
    },
    [],
  );

  const stopClipDragAutoScroll = useCallback(() => {
    clipDragPointerRef.current = null;
    if (clipDragScrollRaf.current) {
      cancelAnimationFrame(clipDragScrollRaf.current);
      clipDragScrollRaf.current = 0;
    }
  }, []);

  const stepClipDragAutoScroll = useCallback(() => {
    clipDragScrollRaf.current = 0;
    const drag = draggedClipRef.current;
    const pointer = clipDragPointerRef.current;
    const scroll = scrollRef.current;
    if (!drag || !pointer || !scroll) return;

    const rect = scroll.getBoundingClientRect();
    const delta = resolveTimelineAutoScroll(rect, pointer.clientX, pointer.clientY);
    if (delta.x === 0 && delta.y === 0) return;

    const maxScrollLeft = Math.max(0, scroll.scrollWidth - scroll.clientWidth);
    const maxScrollTop = Math.max(0, scroll.scrollHeight - scroll.clientHeight);
    const nextScrollLeft = Math.max(0, Math.min(maxScrollLeft, scroll.scrollLeft + delta.x));
    const nextScrollTop = Math.max(0, Math.min(maxScrollTop, scroll.scrollTop + delta.y));
    const didScroll = nextScrollLeft !== scroll.scrollLeft || nextScrollTop !== scroll.scrollTop;

    if (!didScroll) return;

    scroll.scrollLeft = nextScrollLeft;
    scroll.scrollTop = nextScrollTop;
    setDraggedClip((prev) =>
      prev ? updateDraggedClipPreview(prev, pointer.clientX, pointer.clientY) : prev,
    );

    clipDragScrollRaf.current = requestAnimationFrame(stepClipDragAutoScroll);
  }, [updateDraggedClipPreview]);

  const syncClipDragAutoScroll = useCallback(
    (clientX: number, clientY: number) => {
      clipDragPointerRef.current = { clientX, clientY };
      const scroll = scrollRef.current;
      if (!scroll) return;
      const rect = scroll.getBoundingClientRect();
      const delta = resolveTimelineAutoScroll(rect, clientX, clientY);
      if (delta.x === 0 && delta.y === 0) {
        if (clipDragScrollRaf.current) {
          cancelAnimationFrame(clipDragScrollRaf.current);
          clipDragScrollRaf.current = 0;
        }
        return;
      }
      if (!clipDragScrollRaf.current) {
        clipDragScrollRaf.current = requestAnimationFrame(stepClipDragAutoScroll);
      }
    },
    [stepClipDragAutoScroll],
  );
  const updateDraggedClipPreviewRef = useRef(updateDraggedClipPreview);
  updateDraggedClipPreviewRef.current = updateDraggedClipPreview;
  const syncClipDragAutoScrollRef = useRef(syncClipDragAutoScroll);
  syncClipDragAutoScrollRef.current = syncClipDragAutoScroll;
  const stopClipDragAutoScrollRef = useRef(stopClipDragAutoScroll);
  stopClipDragAutoScrollRef.current = stopClipDragAutoScroll;

  const seekFromX = useCallback(
    (clientX: number) => {
      const el = scrollRef.current;
      if (!el || effectiveDuration <= 0) return;
      const rect = el.getBoundingClientRect();
      const scrollLeft = el.scrollLeft;
      const x = clientX - rect.left + scrollLeft - GUTTER;
      if (x < 0) return;
      const time = Math.max(0, Math.min(effectiveDuration, x / pps));
      liveTime.notify(time);
      onSeek?.(time);
    },
    [effectiveDuration, onSeek, pps],
  );

  // Auto-scroll the timeline when dragging the playhead near edges
  const autoScrollDuringDrag = useCallback(
    (clientX: number) => {
      cancelAnimationFrame(dragScrollRaf.current);
      const el = scrollRef.current;
      if (
        !el ||
        !isDragging.current ||
        !shouldAutoScrollTimeline(zoomModeRef.current, el.scrollWidth, el.clientWidth)
      ) {
        return;
      }
      const rect = el.getBoundingClientRect();
      const edgeZone = 40;
      const maxSpeed = 12;
      let scrollDelta = 0;

      if (clientX < rect.left + edgeZone) {
        // Near left edge — scroll left
        const proximity = Math.max(0, 1 - (clientX - rect.left) / edgeZone);
        scrollDelta = -maxSpeed * proximity;
      } else if (clientX > rect.right - edgeZone) {
        // Near right edge — scroll right
        const proximity = Math.max(0, 1 - (rect.right - clientX) / edgeZone);
        scrollDelta = maxSpeed * proximity;
      }

      if (scrollDelta !== 0) {
        el.scrollLeft += scrollDelta;
        seekFromX(clientX);
        dragScrollRaf.current = requestAnimationFrame(() => autoScrollDuringDrag(clientX));
      }
    },
    [seekFromX],
  );

  useMountEffect(() => {
    const clearSuppressedClick = () => {
      requestAnimationFrame(() => {
        suppressClickRef.current = false;
      });
    };

    const handleWindowPointerMove = (e: PointerEvent) => {
      const drag = draggedClipRef.current;
      const resize = resizingClipRef.current;
      if (resize) {
        const distance = Math.abs(e.clientX - resize.originClientX);
        if (!resize.started && distance < 2) return;

        setShowPopover(false);
        setRangeSelection(null);

        const sourceRemaining =
          resize.element.sourceDuration != null
            ? Math.max(
                0,
                (resize.element.sourceDuration - (resize.element.playbackStart ?? 0)) /
                  Math.max(resize.element.playbackRate ?? 1, 0.1),
              )
            : Number.POSITIVE_INFINITY;
        const nextResize = resolveTimelineResize(
          {
            start: resize.element.start,
            duration: resize.element.duration,
            originClientX: resize.originClientX,
            pixelsPerSecond: ppsRef.current,
            minStart: 0,
            maxEnd: Math.min(durationRef.current, resize.element.start + sourceRemaining),
            playbackStart: resize.element.playbackStart,
            playbackRate: resize.element.playbackRate,
          },
          resize.edge,
          e.clientX,
        );

        setResizingClip((prev) =>
          prev
            ? {
                ...prev,
                started: true,
                previewStart: nextResize.start,
                previewDuration: nextResize.duration,
                previewPlaybackStart: nextResize.playbackStart,
              }
            : prev,
        );
        return;
      }
      if (!drag) return;

      const distance = Math.hypot(e.clientX - drag.originClientX, e.clientY - drag.originClientY);
      if (!drag.started && distance < 4) return;

      setShowPopover(false);
      setRangeSelection(null);

      setDraggedClip((prev) =>
        prev ? updateDraggedClipPreviewRef.current(prev, e.clientX, e.clientY) : prev,
      );
      syncClipDragAutoScrollRef.current(e.clientX, e.clientY);
    };

    const handleWindowPointerUp = () => {
      stopClipDragAutoScrollRef.current();
      const resize = resizingClipRef.current;
      if (resize) {
        resizingClipRef.current = null;
        setResizingClip(null);

        if (!resize.started) return;

        suppressClickRef.current = true;
        clearSuppressedClick();

        const hasChanged =
          resize.previewStart !== resize.element.start ||
          resize.previewDuration !== resize.element.duration ||
          resize.previewPlaybackStart !== resize.element.playbackStart;
        if (!hasChanged) return;

        updateElement(resize.element.key ?? resize.element.id, {
          start: resize.previewStart,
          duration: resize.previewDuration,
          playbackStart: resize.previewPlaybackStart,
        });

        Promise.resolve(
          onResizeElementRef.current?.(resize.element, {
            start: resize.previewStart,
            duration: resize.previewDuration,
            playbackStart: resize.previewPlaybackStart,
          }),
        ).catch((error) => {
          updateElement(resize.element.key ?? resize.element.id, {
            start: resize.element.start,
            duration: resize.element.duration,
            playbackStart: resize.element.playbackStart,
          });
          console.error("[Timeline] Failed to persist clip resize", error);
        });
        return;
      }

      const drag = draggedClipRef.current;
      if (!drag) return;
      draggedClipRef.current = null;
      setDraggedClip(null);

      if (!drag.started) return;

      suppressClickRef.current = true;
      clearSuppressedClick();

      const hasChanged =
        drag.previewStart !== drag.element.start || drag.previewTrack !== drag.element.track;
      if (!hasChanged) return;

      updateElement(drag.element.key ?? drag.element.id, {
        start: drag.previewStart,
        track: drag.previewTrack,
      });

      Promise.resolve(
        onMoveElementRef.current?.(drag.element, {
          start: drag.previewStart,
          track: drag.previewTrack,
        }),
      ).catch((error) => {
        updateElement(drag.element.key ?? drag.element.id, {
          start: drag.element.start,
          track: drag.element.track,
        });
        console.error("[Timeline] Failed to persist clip move", error);
      });
    };

    window.addEventListener("pointermove", handleWindowPointerMove);
    window.addEventListener("pointerup", handleWindowPointerUp);
    window.addEventListener("pointercancel", handleWindowPointerUp);
    return () => {
      stopClipDragAutoScrollRef.current();
      window.removeEventListener("pointermove", handleWindowPointerMove);
      window.removeEventListener("pointerup", handleWindowPointerUp);
      window.removeEventListener("pointercancel", handleWindowPointerUp);
    };
  });

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return;

      // Shift+click starts range selection — even on clips
      if (e.shiftKey) {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        isRangeSelecting.current = true;
        setShowPopover(false);
        const rect = scrollRef.current?.getBoundingClientRect();
        if (rect) {
          const x = e.clientX - rect.left + (scrollRef.current?.scrollLeft ?? 0) - GUTTER;
          const time = Math.max(0, x / pps);
          rangeAnchorTime.current = time;
          setRangeSelection({ start: time, end: time, anchorX: e.clientX, anchorY: e.clientY });
        }
        return;
      }

      // Normal click on a clip — let the clip handle it
      if ((e.target as HTMLElement).closest("[data-clip]")) return;
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);

      isDragging.current = true;
      setRangeSelection(null);
      setShowPopover(false);
      seekFromX(e.clientX);
    },
    [seekFromX, pps],
  );
  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (isRangeSelecting.current) {
        const rect = scrollRef.current?.getBoundingClientRect();
        if (rect) {
          const x = e.clientX - rect.left + (scrollRef.current?.scrollLeft ?? 0) - GUTTER;
          const time = Math.max(0, x / pps);
          setRangeSelection((prev) =>
            prev ? { ...prev, end: time, anchorX: e.clientX, anchorY: e.clientY } : null,
          );
        }
        return;
      }
      if (!isDragging.current) return;
      seekFromX(e.clientX);
      autoScrollDuringDrag(e.clientX);
    },
    [seekFromX, autoScrollDuringDrag, pps],
  );
  const handlePointerUp = useCallback(() => {
    if (isRangeSelecting.current) {
      isRangeSelecting.current = false;
      // Show popover if range is meaningful (> 0.2s)
      setRangeSelection((prev) => {
        if (prev && Math.abs(prev.end - prev.start) > 0.2) {
          setShowPopover(true);
          return prev;
        }
        return null;
      });
      return;
    }
    isDragging.current = false;
    cancelAnimationFrame(dragScrollRaf.current);
  }, []);

  const { major, minor } = useMemo(() => generateTicks(effectiveDuration), [effectiveDuration]);
  const getPreviewElement = useCallback(
    (element: TimelineElement): TimelineElement => {
      if (resizingClip?.element.id === element.id) {
        return {
          ...element,
          start: resizingClip.previewStart,
          duration: resizingClip.previewDuration,
          playbackStart: resizingClip.previewPlaybackStart,
        };
      }
      return element;
    },
    [resizingClip],
  );

  const [isDragOver, setIsDragOver] = useState(false);

  if (!timelineReady || elements.length === 0) {
    return (
      <div
        className={`h-full border-t bg-[#0a0a0b] flex flex-col select-none transition-colors duration-150 ${
          isDragOver ? "border-studio-accent/50 bg-studio-accent/[0.03]" : "border-neutral-800/50"
        }`}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragOver(true);
        }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragOver(false);
          if (onFileDrop && e.dataTransfer.files.length > 0) {
            onFileDrop(Array.from(e.dataTransfer.files));
          }
        }}
      >
        {/* Ruler */}
        <div
          className="flex-shrink-0 border-b border-neutral-800/40 flex items-end relative"
          style={{ height: RULER_H, paddingLeft: GUTTER }}
        >
          {[0, 10, 20, 30, 40, 50].map((s) => (
            <div
              key={s}
              className="flex flex-col items-center"
              style={{ position: "absolute", left: GUTTER + s * 14 }}
            >
              <span className="text-[9px] text-neutral-600 font-mono tabular-nums leading-none mb-0.5">
                {`${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`}
              </span>
              <div className="w-px h-[5px] bg-neutral-700/40" />
            </div>
          ))}
        </div>
        {/* Empty drop zone */}
        <div className="flex-1 flex items-center justify-center">
          <div
            className={`flex items-center gap-3 px-6 py-3 border border-dashed rounded-lg transition-colors duration-150 ${
              isDragOver
                ? "border-studio-accent/60 bg-studio-accent/[0.06]"
                : "border-neutral-700/50"
            }`}
          >
            {isDragOver ? (
              <>
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="text-studio-accent flex-shrink-0"
                >
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                <span className="text-[13px] text-studio-accent">Drop media files to import</span>
              </>
            ) : (
              <>
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="text-neutral-600 flex-shrink-0"
                >
                  <rect x="2" y="2" width="20" height="20" rx="2" />
                  <path d="M7 2v20" />
                  <path d="M17 2v20" />
                  <path d="M2 7h20" />
                  <path d="M2 17h20" />
                </svg>
                <span className="text-[13px] text-neutral-500">
                  {onFileDrop
                    ? "Drop media here or describe your video to start"
                    : "Describe your video to start creating"}
                </span>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  const totalH = RULER_H + displayTrackOrder.length * TRACK_H;
  const draggedElement = draggedClip?.element ?? null;
  const activeDraggedElement =
    draggedClip?.started === true && draggedElement
      ? getRenderedTimelineElement({
          element: draggedElement,
          draggedElementId: draggedElement.id,
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
  const renderClipChildren = (element: TimelineElement, clipStyle: TrackVisualStyle) => {
    return (
      <>
        {renderClipOverlay?.(element)}
        <div
          className={
            renderClipContent
              ? "absolute inset-0 overflow-hidden"
              : "flex flex-col justify-center overflow-hidden flex-1 min-w-0 px-6"
          }
        >
          {renderClipContent?.(element, clipStyle) ?? (
            <div className="flex h-full min-h-0 flex-col justify-between py-3">
              <div className="flex items-start">
                <span
                  className="max-w-full truncate rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] leading-none"
                  style={{
                    color: clipStyle.label,
                    background: `${clipStyle.accent}26`,
                    boxShadow: `inset 0 0 0 1px ${clipStyle.accent}33`,
                  }}
                >
                  {element.tag}
                </span>
              </div>
              <span
                className="text-[14px] font-semibold truncate leading-none tracking-[-0.02em]"
                style={{ color: theme.textPrimary }}
              >
                {element.id || element.tag}
              </span>
              <div className="flex items-center">
                <span
                  className="max-w-full truncate rounded-md px-1.5 py-0.5 text-[10px] font-medium tabular-nums leading-none"
                  style={{
                    color: theme.textSecondary,
                    background: "rgba(255,255,255,0.04)",
                  }}
                >
                  {formatTime(element.start)} {"\u2192"}{" "}
                  {formatTime(element.start + element.duration)}
                </span>
              </div>
            </div>
          )}
        </div>
      </>
    );
  };

  return (
    <div
      ref={setContainerRef}
      aria-label="Timeline"
      className={`border-t select-none h-full overflow-hidden ${shiftHeld ? "cursor-crosshair" : "cursor-default"}`}
      style={{
        touchAction: "pan-x pan-y",
        background: theme.shellBackground,
        borderColor: theme.shellBorder,
      }}
    >
      <div
        ref={scrollRef}
        className={`${zoomMode === "fit" ? "overflow-x-hidden" : "overflow-x-auto"} overflow-y-auto h-full`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onLostPointerCapture={handlePointerUp}
      >
        <div className="relative" style={{ height: totalH, width: GUTTER + trackContentWidth }}>
          {/* Grid lines */}
          <svg
            className="absolute pointer-events-none"
            style={{ left: GUTTER, width: trackContentWidth }}
            height={totalH}
          >
            {major.map((t) => {
              const x = t * pps;
              return (
                <line
                  key={`g-${t}`}
                  x1={x}
                  y1={RULER_H}
                  x2={x}
                  y2={totalH}
                  stroke={theme.tickMinor}
                  strokeWidth="1"
                />
              );
            })}
          </svg>

          {/* Ruler */}
          <div
            className="relative overflow-hidden"
            style={{ height: RULER_H, marginLeft: GUTTER, width: trackContentWidth }}
          >
            {/* Shift hint */}
            {shiftHeld && !rangeSelection && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
                <span className="text-[9px] font-medium" style={{ color: theme.textSecondary }}>
                  Drag to select range
                </span>
              </div>
            )}
            {minor.map((t) => (
              <div key={`m-${t}`} className="absolute bottom-0" style={{ left: t * pps }}>
                <div className="w-px h-[3px]" style={{ background: theme.tickMinor }} />
              </div>
            ))}
            {major.map((t) => (
              <div
                key={`M-${t}`}
                className="absolute bottom-0 flex flex-col items-center"
                style={{ left: t * pps }}
              >
                <span
                  className="text-[9px] font-mono tabular-nums leading-none mb-0.5"
                  style={{ color: theme.tickText }}
                >
                  {formatTime(t)}
                </span>
                <div className="w-px h-[5px]" style={{ background: theme.tickMajor }} />
              </div>
            ))}
          </div>

          {/* Tracks */}
          {displayTrackOrder.map((trackNum) => {
            const els = tracks.find(([currentTrack]) => currentTrack === trackNum)?.[1] ?? [];
            const ts = trackStyles.get(trackNum) ?? getStyle("");
            const isPendingTrack =
              draggedClip?.started === true && !trackOrder.includes(trackNum) && els.length === 0;
            return (
              <div
                key={trackNum}
                className="relative flex"
                style={{
                  height: TRACK_H,
                  background: theme.rowBackground,
                  borderBottom: `1px solid ${theme.rowBorder}`,
                }}
              >
                <div
                  className="flex-shrink-0 flex items-center justify-center"
                  style={{
                    width: GUTTER,
                    background: theme.gutterBackground,
                    borderRight: `1px solid ${theme.gutterBorder}`,
                  }}
                >
                  <div
                    className="flex items-center justify-center"
                    style={{
                      width: 18,
                      height: 18,
                      borderRadius: 6,
                      backgroundColor: ts.iconBackground,
                      border: `1px solid ${theme.gutterBorder}`,
                      color: "#fff",
                    }}
                  >
                    {ts.icon}
                  </div>
                </div>

                {/* Clips */}
                <div style={{ width: trackContentWidth }} className="relative">
                  {isPendingTrack && (
                    <div
                      className="absolute inset-0 flex items-center"
                      style={{
                        paddingLeft: 16,
                        color: ts.label,
                        fontSize: 11,
                        letterSpacing: "0.08em",
                        textTransform: "uppercase",
                        background: `linear-gradient(90deg, ${ts.accent}14, transparent 28%)`,
                        boxShadow: `inset 0 0 0 1px ${ts.accent}24`,
                      }}
                    >
                      New track
                    </div>
                  )}
                  {els.map((el, i) => {
                    const clipStyle = getStyle(el.tag);
                    const elementKey = el.key ?? el.id;
                    const isSelected = selectedElementId === elementKey;
                    const isComposition = !!el.compositionSrc;
                    const clipKey = `${elementKey}-${i}`;
                    const isHovered = hoveredClip === clipKey;
                    const hasCustomContent = !!renderClipContent;
                    const isDragging =
                      draggedClip?.started === true &&
                      (draggedElement?.key ?? draggedElement?.id) === elementKey;
                    if (isDragging) return null;
                    const previewElement = getPreviewElement(el);

                    return (
                      <TimelineClip
                        key={clipKey}
                        el={previewElement}
                        pps={pps}
                        clipY={CLIP_Y}
                        isSelected={isSelected}
                        isHovered={isHovered}
                        isDragging={false}
                        hasCustomContent={hasCustomContent}
                        theme={theme}
                        trackStyle={clipStyle}
                        isComposition={isComposition}
                        onHoverStart={() => setHoveredClip(clipKey)}
                        onHoverEnd={() => setHoveredClip(null)}
                        onResizeStart={(edge, e) => {
                          if (e.button !== 0 || e.shiftKey || !onResizeElement) return;
                          e.stopPropagation();
                          setShowPopover(false);
                          setRangeSelection(null);
                          setResizingClip({
                            element: el,
                            edge,
                            originClientX: e.clientX,
                            previewStart: el.start,
                            previewDuration: el.duration,
                            previewPlaybackStart: el.playbackStart,
                            started: false,
                          });
                        }}
                        onPointerDown={(e) => {
                          if (e.button !== 0 || e.shiftKey || !onMoveElement) return;
                          setShowPopover(false);
                          setRangeSelection(null);
                          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
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
                            started: false,
                          });
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (suppressClickRef.current) return;
                          setSelectedElementId(isSelected ? null : elementKey);
                        }}
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          if (suppressClickRef.current) return;
                          if (isComposition && onDrillDown) onDrillDown(el);
                        }}
                      >
                        {renderClipChildren(previewElement, clipStyle)}
                      </TimelineClip>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {activeDraggedElement && activeDraggedPosition && (
            <div
              className="absolute pointer-events-none"
              style={{
                top: activeDraggedPosition.top,
                left: activeDraggedPosition.left,
                width: Math.max(activeDraggedElement.duration * pps, 4),
                height: TRACK_H - CLIP_Y * 2,
                zIndex: 40,
              }}
            >
              <TimelineClip
                el={{ ...activeDraggedElement, start: 0 }}
                pps={pps}
                clipY={0}
                isSelected={
                  selectedElementId === (activeDraggedElement.key ?? activeDraggedElement.id)
                }
                isHovered={false}
                isDragging={true}
                hasCustomContent={!!renderClipContent}
                theme={theme}
                trackStyle={getStyle(activeDraggedElement.tag)}
                isComposition={!!activeDraggedElement.compositionSrc}
                onHoverStart={() => {}}
                onHoverEnd={() => {}}
                onResizeStart={() => {}}
                onClick={() => {}}
                onDoubleClick={() => {}}
              >
                {renderClipChildren(activeDraggedElement, getStyle(activeDraggedElement.tag))}
              </TimelineClip>
            </div>
          )}

          {/* Range selection highlight */}
          {rangeSelection && (
            <div
              className="absolute pointer-events-none"
              style={{
                left: GUTTER + Math.min(rangeSelection.start, rangeSelection.end) * pps,
                width: Math.abs(rangeSelection.end - rangeSelection.start) * pps,
                top: RULER_H,
                bottom: 0,
                backgroundColor: "rgba(59, 130, 246, 0.12)",
                borderLeft: "1px solid rgba(59, 130, 246, 0.4)",
                borderRight: "1px solid rgba(59, 130, 246, 0.4)",
                zIndex: 50,
              }}
            />
          )}

          {/* Playhead — z-[100] to stay above all clips (which use z-1 to z-10) */}
          <div
            ref={playheadRef}
            className="absolute top-0 bottom-0 pointer-events-none"
            style={{ left: `${GUTTER}px`, zIndex: 100 }}
          >
            <div
              className="absolute top-0 bottom-0"
              style={{
                left: "50%",
                width: 2,
                marginLeft: -1,
                background: "var(--hf-accent, #3CE6AC)",
                boxShadow: "0 0 8px rgba(60,230,172,0.5)",
              }}
            />
            <div
              className="absolute"
              style={{ left: "50%", top: 0, transform: "translateX(-50%)" }}
            >
              <div
                style={{
                  width: 0,
                  height: 0,
                  borderLeft: "6px solid transparent",
                  borderRight: "6px solid transparent",
                  borderTop: "8px solid var(--hf-accent, #3CE6AC)",
                  filter: "drop-shadow(0 1px 3px rgba(0,0,0,0.6))",
                }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Keyboard shortcut hint — always visible */}
      {!showPopover && !rangeSelection && (
        <div className="absolute bottom-2 right-3 pointer-events-none z-20">
          <div
            className="flex items-center gap-1.5 px-2 py-1 rounded-md border"
            style={{
              background: "rgba(17,23,35,0.84)",
              borderColor: theme.gutterBorder,
            }}
          >
            <kbd
              className="text-[9px] font-mono px-1 py-0.5 rounded"
              style={{ color: theme.textSecondary, background: "rgba(255,255,255,0.06)" }}
            >
              Shift
            </kbd>
            <span className="text-[9px]" style={{ color: theme.textSecondary }}>
              + drag to edit range
            </span>
          </div>
        </div>
      )}

      {/* Edit range popover */}
      {showPopover && rangeSelection && (
        <EditPopover
          rangeStart={rangeSelection.start}
          rangeEnd={rangeSelection.end}
          anchorX={rangeSelection.anchorX}
          anchorY={rangeSelection.anchorY}
          onClose={() => {
            setShowPopover(false);
            setRangeSelection(null);
          }}
        />
      )}
    </div>
  );
});
