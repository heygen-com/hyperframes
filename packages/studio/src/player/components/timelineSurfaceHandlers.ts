import type { MouseEvent, PointerEvent, RefObject, UIEvent } from "react";
import { getTimelineContentXFromClient } from "./timelineLayout";

interface TimelineSurfaceHandlersInput {
  activeTool: string;
  scrollRef: RefObject<HTMLDivElement | null>;
  setRazorGuideX: (position: number | null) => void;
  lastScrollLeftRef: RefObject<number>;
  syncScrollViewport: (element: HTMLDivElement, isScrolling?: boolean) => void;
  contentOrigin: number;
  pixelsPerSecond: number;
  onRazorSplitAll?: (time: number) => void;
  handlePointerDown: (event: PointerEvent<HTMLDivElement>) => void;
}

export function createTimelineSurfaceHandlers({
  activeTool,
  scrollRef,
  setRazorGuideX,
  lastScrollLeftRef,
  syncScrollViewport,
  contentOrigin,
  pixelsPerSecond,
  onRazorSplitAll,
  handlePointerDown,
}: TimelineSurfaceHandlersInput) {
  const onMouseMove = (event: MouseEvent<HTMLDivElement>) => {
    if (activeTool === "razor" && scrollRef.current) {
      const rect = scrollRef.current.getBoundingClientRect();
      setRazorGuideX(event.clientX - rect.left + scrollRef.current.scrollLeft);
    }
  };
  const onScroll = (event: UIEvent<HTMLDivElement>) => {
    lastScrollLeftRef.current = event.currentTarget.scrollLeft;
    syncScrollViewport(event.currentTarget, true);
  };
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.target instanceof Element && event.target.closest("button, input, select, a")) return;
    if (activeTool === "razor" && event.shiftKey && event.button === 0 && scrollRef.current) {
      const rect = scrollRef.current.getBoundingClientRect();
      const x = getTimelineContentXFromClient({
        clientX: event.clientX,
        rectLeft: rect.left,
        scrollLeft: scrollRef.current.scrollLeft,
        contentOrigin,
      });
      onRazorSplitAll?.(Math.max(0, x / pixelsPerSecond));
      return;
    }
    handlePointerDown(event);
  };
  return {
    onMouseMove,
    onMouseLeave: () => setRazorGuideX(null),
    onScroll,
    onPointerDown,
  };
}
