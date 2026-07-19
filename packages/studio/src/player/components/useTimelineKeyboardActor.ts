import { useCallback, type FocusEvent, type KeyboardEvent, type RefObject } from "react";
import { usePlayerStore } from "../store/playerStore";
import type { TimelineRowGeometry } from "./timelineLayout";
import {
  isTimelineNavigationKey,
  locateTimelineLogicalTarget,
  resolveTimelineNavigationTarget,
  type TimelineLogicalRow,
} from "./timelineKeyboardNavigation";

interface TimelineKeyboardActorInput {
  logicalRows: readonly TimelineLogicalRow[];
  focusedTargetId: string | null;
  rowGeometry: TimelineRowGeometry;
  scrollRef: RefObject<HTMLDivElement | null>;
  onToggleRow: (target: TimelineLogicalRow) => void;
}

function eventTarget(event: FocusEvent | KeyboardEvent): HTMLElement | null {
  if (!(event.target instanceof Element)) return null;
  const target = event.target.closest<HTMLElement>("[data-timeline-focus-id]");
  return target && event.currentTarget.contains(target) ? target : null;
}

function viewportPageSize(
  rows: readonly TimelineLogicalRow[],
  geometry: TimelineRowGeometry,
  viewport: HTMLDivElement | null,
): number {
  if (!viewport || rows.length === 0) return 1;
  const first = Math.max(0, Math.floor(geometry.getRowFromY(viewport.scrollTop)));
  const last = Math.min(
    geometry.rowKeys.length - 1,
    Math.floor(geometry.getRowFromY(viewport.scrollTop + viewport.clientHeight)),
  );
  const visibleTracks = new Set(geometry.rowKeys.slice(first, last + 1));
  return Math.max(1, rows.filter((row) => visibleTracks.has(row.physicalTrackKey)).length);
}

function openContextMenu(target: HTMLElement): void {
  const bounds = target.getBoundingClientRect();
  target.dispatchEvent(
    new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: bounds.left + bounds.width / 2,
      clientY: bounds.top + bounds.height / 2,
    }),
  );
}

/** The timeline's sole keyboard actor; controls only describe their logical identity. */
export function useTimelineKeyboardActor({
  logicalRows,
  focusedTargetId,
  rowGeometry,
  scrollRef,
  onToggleRow,
}: TimelineKeyboardActorInput) {
  const rovingTargetId =
    (focusedTargetId && locateTimelineLogicalTarget(logicalRows, focusedTargetId)?.target.id) ??
    logicalRows[0]?.id ??
    null;

  const onFocus = useCallback(
    (event: FocusEvent<HTMLElement>) => {
      const id = eventTarget(event)?.dataset.timelineFocusId;
      if (id && id !== focusedTargetId) usePlayerStore.getState().requestTimelineFocus(id);
    },
    [focusedTargetId],
  );

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      const targetElement = eventTarget(event);
      const id = targetElement?.dataset.timelineFocusId;
      if (!targetElement || !id) return;
      const located = locateTimelineLogicalTarget(logicalRows, id);
      if (!located) return;

      if (isTimelineNavigationKey(event.key)) {
        const next = resolveTimelineNavigationTarget(logicalRows, id, event.key, {
          pageSize: viewportPageSize(logicalRows, rowGeometry, scrollRef.current),
          timelineBoundary: event.ctrlKey || event.metaKey,
        });
        event.preventDefault();
        if (next && next.id !== id) usePlayerStore.getState().requestTimelineFocus(next.id);
        return;
      }
      if (event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey)) {
        event.preventDefault();
        openContextMenu(targetElement);
        return;
      }
      if (
        (event.key !== "Enter" && event.key !== " ") ||
        located.target.kind !== "row" ||
        !located.target.expandable
      ) {
        return;
      }
      event.preventDefault();
      onToggleRow(located.target);
    },
    [logicalRows, onToggleRow, rowGeometry, scrollRef],
  );

  return { rovingTargetId, onFocus, onKeyDown };
}
