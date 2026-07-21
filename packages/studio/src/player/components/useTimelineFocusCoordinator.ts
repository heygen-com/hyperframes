import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import type { TimelineElement } from "../store/playerStore";
import { usePlayerStore } from "../store/playerStore";
import type { TimelineFocusRequest } from "../store/timelineFocusState";
import type { TimelineRowGeometry } from "./timelineLayout";
import { CLIP_Y, RULER_H } from "./timelineLayout";
import {
  locateTimelineLogicalTarget,
  resolveTimelineFocusFallback,
  type TimelineLogicalRow,
  type TimelineLogicalTarget,
} from "./timelineKeyboardNavigation";
import { computeRevealScroll } from "./timelineRevealScroll";

interface TimelineFocusCoordinatorInput {
  scrollRef: RefObject<HTMLDivElement | null>;
  logicalRows: readonly TimelineLogicalRow[];
  elements: readonly TimelineElement[];
  rowGeometry: TimelineRowGeometry;
  pixelsPerSecond: number;
  contentOrigin: number;
  allowHorizontal: boolean;
  viewportVersion: unknown;
  projectId: string | null;
  sessionEpoch: number;
  syncScrollViewport: (element: HTMLDivElement) => void;
}

export interface TimelineFocusCoordinatorState {
  focusedTargetId: string | null;
  focusedRowKey: number | undefined;
  pinnedElementId: string | undefined;
}

interface ResolvedFocus {
  target: TimelineLogicalTarget;
  row: TimelineLogicalRow;
}

function isCurrentRequest(
  request: TimelineFocusRequest | null,
  projectId: string | null,
  sessionEpoch: number,
): request is TimelineFocusRequest {
  return (
    request !== null && request.projectId === projectId && request.sessionEpoch === sessionEpoch
  );
}

function focusElement(container: HTMLDivElement, targetId: string): boolean {
  const target = [...container.querySelectorAll<HTMLElement>("[data-timeline-focus-id]")].find(
    (candidate) => candidate.dataset.timelineFocusId === targetId,
  );
  if (!target) return false;
  if (target.ownerDocument.activeElement === target) return true;
  target.setAttribute("data-reveal-highlight", "true");
  target.focus({ preventScroll: true });
  if (target.ownerDocument.activeElement !== target) {
    target.removeAttribute("data-reveal-highlight");
    return false;
  }
  target.addEventListener("blur", () => target.removeAttribute("data-reveal-highlight"), {
    once: true,
  });
  return true;
}

function scrollToTarget(
  container: HTMLDivElement,
  resolution: ResolvedFocus,
  elements: readonly TimelineElement[],
  rowGeometry: TimelineRowGeometry,
  pixelsPerSecond: number,
  contentOrigin: number,
  allowHorizontal: boolean,
): boolean {
  const rowIndex = rowGeometry.getRowIndex(resolution.row.physicalTrackKey);
  if (rowIndex < 0) return false;
  const elementId =
    resolution.target.kind === "row" ? resolution.row.elementId : resolution.target.elementId;
  const element = elementId
    ? elements.find((candidate) => (candidate.key ?? candidate.id) === elementId)
    : undefined;
  const pointTime = resolution.target.kind === "row" ? null : resolution.target.time;
  const left = element && resolution.target.kind === "clip" ? element.start : pointTime;
  const right =
    element && resolution.target.kind === "clip" ? element.start + element.duration : pointTime;
  const rowTop = rowGeometry.getRowTop(rowIndex);
  const target = computeRevealScroll({
    scrollLeft: container.scrollLeft,
    scrollTop: container.scrollTop,
    viewportWidth: container.clientWidth,
    viewportHeight: container.clientHeight,
    clipLeft: contentOrigin + (left ?? 0) * pixelsPerSecond,
    clipRight: contentOrigin + (right ?? 0) * pixelsPerSecond,
    clipTop: rowTop + CLIP_Y,
    clipBottom: rowTop + rowGeometry.getRowHeight(rowIndex) - CLIP_Y,
    stickyLeft: contentOrigin,
    stickyTop: RULER_H,
    allowHorizontal: allowHorizontal && left !== null,
  });
  if (target.left !== null) container.scrollLeft = target.left;
  if (target.top !== null) container.scrollTop = target.top;
  return target.left !== null || target.top !== null;
}

/** Model-first focus actor; mounting is a consequence of its returned pins. */
export function useTimelineFocusCoordinator({
  scrollRef,
  logicalRows,
  elements,
  rowGeometry,
  pixelsPerSecond,
  contentOrigin,
  allowHorizontal,
  viewportVersion,
  projectId,
  sessionEpoch,
  syncScrollViewport,
}: TimelineFocusCoordinatorInput): TimelineFocusCoordinatorState {
  const request = usePlayerStore((state) => state.timelineFocus);
  const previousRowsRef = useRef(logicalRows);
  const resolvedRef = useRef<{ nonce: number; id: string } | null>(null);
  const appliedRef = useRef<{ nonce: number; id: string } | null>(null);
  let resolution: ResolvedFocus | null = null;

  if (isCurrentRequest(request, projectId, sessionEpoch)) {
    if (resolvedRef.current?.nonce !== request.nonce) {
      resolvedRef.current = { nonce: request.nonce, id: request.id };
    }
    const resolvedId = resolvedRef.current.id;
    let located = locateTimelineLogicalTarget(logicalRows, resolvedId);
    if (!located) {
      const fallback = resolveTimelineFocusFallback(
        previousRowsRef.current,
        logicalRows,
        resolvedId,
      );
      if (fallback) {
        resolvedRef.current = { nonce: request.nonce, id: fallback.id };
        located = locateTimelineLogicalTarget(logicalRows, fallback.id);
      }
    }
    if (located) resolution = { target: located.target, row: located.row };
  } else {
    resolvedRef.current = null;
  }

  useLayoutEffect(() => {
    previousRowsRef.current = logicalRows;
  }, [logicalRows]);

  useEffect(() => {
    if (!isCurrentRequest(request, projectId, sessionEpoch)) return;
    if (!resolution) {
      usePlayerStore.getState().clearTimelineFocus(request.nonce);
      return;
    }
    if (resolution.target.id !== request.id) {
      usePlayerStore.getState().requestTimelineFocus(resolution.target.id);
      return;
    }
    if (
      appliedRef.current?.nonce === request.nonce &&
      appliedRef.current.id === resolution.target.id
    ) {
      return;
    }
    const container = scrollRef.current;
    if (!container) return;
    if (
      scrollToTarget(
        container,
        resolution,
        elements,
        rowGeometry,
        pixelsPerSecond,
        contentOrigin,
        allowHorizontal,
      )
    ) {
      syncScrollViewport(container);
    }
    if (!focusElement(container, resolution.target.id)) return;
    appliedRef.current = { nonce: request.nonce, id: resolution.target.id };
  }, [
    allowHorizontal,
    contentOrigin,
    elements,
    pixelsPerSecond,
    projectId,
    request,
    resolution,
    rowGeometry,
    scrollRef,
    sessionEpoch,
    syncScrollViewport,
    viewportVersion,
  ]);

  const pinnedElementId = resolution
    ? resolution.target.kind === "row"
      ? (resolution.row.elementId ?? undefined)
      : resolution.target.elementId
    : undefined;
  return {
    focusedTargetId: resolution?.target.id ?? null,
    focusedRowKey: resolution?.row.physicalTrackKey,
    pinnedElementId,
  };
}
