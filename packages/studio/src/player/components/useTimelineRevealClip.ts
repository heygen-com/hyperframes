import { useEffect, useRef } from "react";
import type { TimelineElement } from "../store/playerStore";
import { usePlayerStore } from "../store/playerStore";
import { CLIP_Y, RULER_H, type TimelineRowGeometry } from "./timelineLayout";
import { computeRevealScroll } from "./timelineRevealScroll";

interface UseTimelineRevealClipInput {
  scrollRef: React.RefObject<HTMLDivElement | null>;
  elements: readonly TimelineElement[];
  rowGeometry: TimelineRowGeometry;
  pixelsPerSecond: number;
  contentOrigin: number;
  allowHorizontal: boolean;
  viewportVersion: unknown;
  sessionEpoch: number;
}

function escapeSelectorValue(value: string): string {
  return typeof CSS !== "undefined" && typeof CSS.escape === "function"
    ? CSS.escape(value)
    : value.replace(/["\\]/g, "\\$&");
}

function scrollToTimelineElement(
  container: HTMLDivElement,
  element: TimelineElement,
  row: number,
  rowGeometry: TimelineRowGeometry,
  pixelsPerSecond: number,
  contentOrigin: number,
  allowHorizontal: boolean,
): void {
  const clipLeft = contentOrigin + element.start * pixelsPerSecond;
  const target = computeRevealScroll({
    scrollLeft: container.scrollLeft,
    scrollTop: container.scrollTop,
    viewportWidth: container.clientWidth,
    viewportHeight: container.clientHeight,
    clipLeft,
    clipRight: clipLeft + Math.max(element.duration * pixelsPerSecond, 4),
    clipTop: rowGeometry.getRowTop(row) + CLIP_Y,
    clipBottom: rowGeometry.getRowTop(row) + rowGeometry.getRowHeight(row) - CLIP_Y,
    stickyLeft: contentOrigin,
    stickyTop: RULER_H,
    allowHorizontal,
  });
  if (target.left !== null) container.scrollLeft = target.left;
  if (target.top !== null) container.scrollTop = target.top;
  if (target.left !== null || target.top !== null) container.dispatchEvent(new Event("scroll"));
}

function focusRevealedElement(container: HTMLDivElement, elementId: string): boolean {
  const clip = container.querySelector(`[data-el-id="${escapeSelectorValue(elementId)}"]`);
  if (!(clip instanceof HTMLElement)) return false;
  clip.setAttribute("data-reveal-highlight", "true");
  clip.focus({ preventScroll: true });
  if (document.activeElement !== clip) {
    clip.removeAttribute("data-reveal-highlight");
    return false;
  }
  clip.addEventListener("blur", () => clip.removeAttribute("data-reveal-highlight"), {
    once: true,
  });
  return true;
}

function resolveRevealTarget(
  elements: readonly TimelineElement[],
  rowGeometry: TimelineRowGeometry,
  elementId: string,
): { element: TimelineElement; row: number } | null {
  const element = elements.find((candidate) => (candidate.key ?? candidate.id) === elementId);
  if (!element) return null;
  const row = rowGeometry.getRowIndex(element.track);
  return row < 0 ? null : { element, row };
}

function shouldScrollReveal(
  previous: { request: { elementId: string; nonce: number }; sessionEpoch: number } | null,
  request: { elementId: string; nonce: number },
  sessionEpoch: number,
): boolean {
  return previous?.request !== request || previous.sessionEpoch !== sessionEpoch;
}

/** Coordinate-first reveal; the request remains pinned until its clip mounts. */
export function useTimelineRevealClip({
  scrollRef,
  elements,
  rowGeometry,
  pixelsPerSecond,
  contentOrigin,
  allowHorizontal,
  viewportVersion,
  sessionEpoch,
}: UseTimelineRevealClipInput): void {
  const revealRequest = usePlayerStore((state) => state.clipRevealRequest);
  const scrolledRequestRef = useRef<{
    request: { elementId: string; nonce: number };
    sessionEpoch: number;
  } | null>(null);

  useEffect(() => {
    if (!revealRequest) {
      scrolledRequestRef.current = null;
      return;
    }
    const target = resolveRevealTarget(elements, rowGeometry, revealRequest.elementId);
    if (!target) {
      usePlayerStore.getState().clearClipRevealRequest();
      return;
    }
    const container = scrollRef.current;
    if (!container) return;

    if (shouldScrollReveal(scrolledRequestRef.current, revealRequest, sessionEpoch)) {
      scrolledRequestRef.current = { request: revealRequest, sessionEpoch };
      scrollToTimelineElement(
        container,
        target.element,
        target.row,
        rowGeometry,
        pixelsPerSecond,
        contentOrigin,
        allowHorizontal,
      );
    }

    if (!focusRevealedElement(container, revealRequest.elementId)) return;
    if (usePlayerStore.getState().clipRevealRequest === revealRequest) {
      usePlayerStore.getState().clearClipRevealRequest();
    }
  }, [
    allowHorizontal,
    contentOrigin,
    elements,
    pixelsPerSecond,
    revealRequest,
    rowGeometry,
    scrollRef,
    sessionEpoch,
    viewportVersion,
  ]);
}
