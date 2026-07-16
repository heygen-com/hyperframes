/**
 * Consumes playerStore.clipRevealRequest: when another surface (the sidebar
 * asset card / audio row) asks for a clip to be revealed, smooth-scroll the
 * timeline's scroll container so that clip is visible — horizontally to its
 * time and vertically to its lane.
 *
 * The request is consumed (cleared) whether or not the clip node is found, so
 * a stale request can never replay a scroll later. Respects zoom mode: in
 * "fit" the timeline disables horizontal scrolling (overflow-x-hidden), so
 * only the vertical axis is scrolled there.
 */
import { useEffect } from "react";
import { usePlayerStore } from "../store/playerStore";
import { GUTTER, RULER_H } from "./timelineLayout";
import { computeRevealScroll } from "./timelineRevealScroll";

export function useTimelineRevealClip(scrollRef: React.RefObject<HTMLDivElement | null>): void {
  const revealRequest = usePlayerStore((s) => s.clipRevealRequest);

  useEffect(() => {
    if (!revealRequest) return;
    // Consume the request first — reveal is one-shot, even when the clip node
    // isn't currently rendered (e.g. drilled into a different composition).
    usePlayerStore.getState().clearClipRevealRequest();

    const container = scrollRef.current;
    if (!container) return;
    const clip = container.querySelector(`[data-el-id="${CSS.escape(revealRequest.elementId)}"]`);
    if (!(clip instanceof HTMLElement)) return;

    const containerRect = container.getBoundingClientRect();
    const clipRect = clip.getBoundingClientRect();
    const clipLeft = clipRect.left - containerRect.left + container.scrollLeft;
    const clipTop = clipRect.top - containerRect.top + container.scrollTop;

    const target = computeRevealScroll({
      scrollLeft: container.scrollLeft,
      scrollTop: container.scrollTop,
      viewportWidth: container.clientWidth,
      viewportHeight: container.clientHeight,
      clipLeft,
      clipRight: clipLeft + clipRect.width,
      clipTop,
      clipBottom: clipTop + clipRect.height,
      stickyLeft: GUTTER,
      stickyTop: RULER_H,
      allowHorizontal: usePlayerStore.getState().zoomMode === "manual",
    });
    if (target.left === null && target.top === null) return;
    container.scrollTo({
      left: target.left ?? container.scrollLeft,
      top: target.top ?? container.scrollTop,
      behavior: "smooth",
    });
  }, [revealRequest, scrollRef]);
}
