import { useEffect, useLayoutEffect, useMemo, useRef, type RefObject } from "react";
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
  // data-timeline-focus-id is the reserved DOM bridge between logical IDs and this actor.
  const target = container.querySelector<HTMLElement>(
    `[data-timeline-focus-id=${CSS.escape(targetId)}]`,
  );
  if (!target) return false;
  if (target.ownerDocument.activeElement === target) return true;
  target.setAttribute("data-reveal-highlight", "true");
  target.focus({ preventScroll: true });
  if (target.ownerDocument.activeElement !== target) {
    target.removeAttribute("data-reveal-highlight");
    return false;
  }
  // The reveal highlight is intentionally one-shot; ordinary refocus uses the standard focus ring.
  target.addEventListener("blur", () => target.removeAttribute("data-reveal-highlight"), {
    once: true,
  });
  return true;
}

// This is one atomic two-axis reveal calculation; each branch selects target geometry only.
// fallow-ignore-next-line complexity
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
// Resolution, fallback, reveal, and focus form one ordered state machine.
// fallow-ignore-next-line complexity
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
  const resolution = useMemo<ResolvedFocus | null>(() => {
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
          // ponytail: Cache the fallback under this nonce so render-phase resolution
          // converges before the effect persists the replacement request.
          resolvedRef.current = { nonce: request.nonce, id: fallback.id };
          located = locateTimelineLogicalTarget(logicalRows, fallback.id);
        }
      }
      return located ? { target: located.target, row: located.row } : null;
    }
    resolvedRef.current = null;
    return null;
  }, [logicalRows, projectId, request, sessionEpoch]);

  useLayoutEffect(() => {
    previousRowsRef.current = logicalRows;
  }, [logicalRows]);

  // Apply a request exactly once after its logical target and DOM node are both ready.
  // fallow-ignore-next-line complexity
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
