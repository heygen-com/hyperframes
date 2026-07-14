import { useCallback, useMemo, useState, type MutableRefObject } from "react";
import { usePlayerStore, type TimelineElement } from "../store/playerStore";
import type { DragCommitDeps } from "./timelineClipDragCommit";
import { resolveAllTrackGaps, resolveCloseGapShifts, resolveTrackGapAt } from "./timelineGaps";
import {
  canShiftTrackGapClips,
  commitCloseAllTrackGaps,
  commitCloseTrackGap,
} from "./timelineGapCommit";

/** Right-click anchor on EMPTY lane space: pointer position + clicked lane/time. */
interface TrackGapMenuAnchor {
  x: number;
  y: number;
  track: number;
  time: number;
}

/**
 * Track-gap context menu (right-click on empty lane space) — state, the
 * derived menu model, and the two commit actions. Extracted from Timeline.tsx
 * as a cohesive unit (600-line studio cap); behavior identical.
 *
 * Only the ANCHOR is state; the menu model (gap under the pointer, compaction,
 * movability) derives from live `tracks` so an open menu reflects concurrent
 * edits. Commits are ONE atomic batch each via the existing move-persist
 * pipeline (see timelineGapCommit.ts).
 */
export function useTrackGapMenu({
  tracks,
  expandedElementsRef,
  trackOrderRef,
  onMoveElement,
  onMoveElements,
}: {
  tracks: [number, TimelineElement[]][];
  expandedElementsRef: MutableRefObject<TimelineElement[]>;
  trackOrderRef: MutableRefObject<number[]>;
  onMoveElement: DragCommitDeps["onMoveElement"];
  onMoveElements: DragCommitDeps["onMoveElements"];
}) {
  const updateElement = usePlayerStore((s) => s.updateElement);
  const [gapContextMenu, setGapContextMenu] = useState<TrackGapMenuAnchor | null>(null);

  const gapMenuLaneElements = useMemo(
    () => (gapContextMenu ? (tracks.find(([t]) => t === gapContextMenu.track)?.[1] ?? []) : null),
    [gapContextMenu, tracks],
  );
  const gapMenuModel = useMemo(() => {
    if (!gapContextMenu || !gapMenuLaneElements) return null;
    const gap = resolveTrackGapAt(gapMenuLaneElements, gapContextMenu.time);
    const allShifts = resolveAllTrackGaps(gapMenuLaneElements);
    return {
      x: gapContextMenu.x,
      y: gapContextMenu.y,
      gapWidth: gap ? gap.gapEnd - gap.gapStart : null,
      canCloseGap:
        gap != null &&
        canShiftTrackGapClips(gapMenuLaneElements, resolveCloseGapShifts(gapMenuLaneElements, gap)),
      hasAnyGaps: allShifts.length > 0,
      canCloseAllGaps:
        allShifts.length > 0 && canShiftTrackGapClips(gapMenuLaneElements, allShifts),
    };
  }, [gapContextMenu, gapMenuLaneElements]);

  const closeTrackGap = useCallback(() => {
    if (!gapContextMenu || !gapMenuLaneElements) return;
    commitCloseTrackGap(gapMenuLaneElements, gapContextMenu.time, {
      elements: expandedElementsRef.current,
      trackOrder: trackOrderRef.current,
      updateElement,
      onMoveElement,
      onMoveElements,
    });
  }, [
    gapContextMenu,
    gapMenuLaneElements,
    expandedElementsRef,
    trackOrderRef,
    updateElement,
    onMoveElement,
    onMoveElements,
  ]);
  const closeAllTrackGaps = useCallback(() => {
    if (!gapMenuLaneElements) return;
    commitCloseAllTrackGaps(gapMenuLaneElements, {
      elements: expandedElementsRef.current,
      trackOrder: trackOrderRef.current,
      updateElement,
      onMoveElement,
      onMoveElements,
    });
  }, [
    gapMenuLaneElements,
    expandedElementsRef,
    trackOrderRef,
    updateElement,
    onMoveElement,
    onMoveElements,
  ]);

  const openGapMenu = useCallback((anchor: TrackGapMenuAnchor) => setGapContextMenu(anchor), []);
  const dismissGapMenu = useCallback(() => setGapContextMenu(null), []);

  return { gapMenuModel, openGapMenu, dismissGapMenu, closeTrackGap, closeAllTrackGaps };
}
