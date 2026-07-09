import { useRef, useState, useCallback, useEffect } from "react";
import { buildClipRangeSelection, type TimelineRangeSelection } from "./timelineEditing";
import type { TimelineElement } from "../store/playerStore";
import { liveTime, usePlayerStore } from "../store/playerStore";
import { GUTTER, RULER_H } from "./timelineLayout";
import {
  computeMarqueeSelection,
  getMarqueeRect,
  isMarqueeDrag,
  type MarqueeClipInput,
} from "./timelineMarquee";
import type { Rect } from "../../utils/marqueeGeometry";

interface UseTimelineRangeSelectionInput {
  scrollRef: React.RefObject<HTMLDivElement | null>;
  ppsRef: React.RefObject<number>;
  effectiveDuration: number;
  pps: number;
  onSeek?: (time: number) => void;
  seekFromX: (clientX: number) => void;
  autoScrollDuringDrag: (clientX: number) => void;
  dragScrollRaf: React.RefObject<number>;
  isDragging: React.RefObject<boolean>;
  setShowPopover: (v: boolean) => void;
  elementsRef: React.RefObject<TimelineElement[]>;
  trackOrderRef: React.RefObject<number[]>;
  onSelectElement?: (element: TimelineElement | null) => void;
}

interface MarqueeDragState {
  originX: number;
  originY: number;
  /** Pre-drag selection, restored on Escape-cancel. */
  baseIds: Set<string>;
  basePrimary: string | null;
  /** Union new hits with baseIds (shift/cmd/ctrl at pointerdown). */
  additive: boolean;
  /** True once the pointer travelled past the click threshold. */
  active: boolean;
}

function snapshotSelection(): { ids: Set<string>; primary: string | null } {
  const s = usePlayerStore.getState();
  const ids = new Set(s.selectedElementIds);
  if (s.selectedElementId) ids.add(s.selectedElementId);
  return { ids, primary: s.selectedElementId };
}

function toMarqueeClips(elements: TimelineElement[]): MarqueeClipInput[] {
  return elements.map((el) => ({
    id: el.key ?? el.id,
    start: el.start,
    duration: el.duration,
    track: el.track,
  }));
}

export function useTimelineRangeSelection({
  scrollRef,
  ppsRef,
  effectiveDuration: _effectiveDuration,
  pps,
  onSeek: _onSeek,
  seekFromX,
  autoScrollDuringDrag,
  dragScrollRaf,
  isDragging,
  setShowPopover,
  elementsRef,
  trackOrderRef,
  onSelectElement,
}: UseTimelineRangeSelectionInput) {
  const isRangeSelecting = useRef(false);
  const rangeAnchorTime = useRef(0);
  const [rangeSelection, setRangeSelection] = useState<TimelineRangeSelection | null>(null);
  const shiftClickClipRef = useRef<{
    element: TimelineElement;
    anchorX: number;
    anchorY: number;
  } | null>(null);

  const seekRafRef = useRef(0);
  const pendingClientXRef = useRef(0);

  // Marquee (rubber-band) multi-select on the empty timeline body.
  const marqueeRef = useRef<MarqueeDragState | null>(null);
  const [marqueeRect, setMarqueeRect] = useState<Rect | null>(null);

  /** Pointer position → canvas/content coordinates (same space as clip rects). */
  const toContentPoint = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } | null => {
      const el = scrollRef.current;
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      return {
        x: clientX - rect.left + el.scrollLeft,
        y: clientY - rect.top + el.scrollTop,
      };
    },
    [scrollRef],
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return;
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
      shiftClickClipRef.current = null;
      if ((e.target as HTMLElement).closest("[data-clip]")) return;
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      setRangeSelection(null);
      setShowPopover(false);
      const point = toContentPoint(e.clientX, e.clientY);
      // Ruler press → scrub the playhead (the standard scrub surface).
      if (!point || point.y < RULER_H) {
        isDragging.current = true;
        seekFromX(e.clientX);
        return;
      }
      // Empty body press → pending marquee. A plain click (no drag past the
      // threshold) deselects on pointerup; a drag draws the marquee. Never scrubs.
      const base = snapshotSelection();
      marqueeRef.current = {
        originX: point.x,
        originY: point.y,
        baseIds: base.ids,
        basePrimary: base.primary,
        additive: e.metaKey || e.ctrlKey,
        active: false,
      };
    },
    [seekFromX, pps, scrollRef, isDragging, setShowPopover, toContentPoint],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (isRangeSelecting.current) {
        const rect = scrollRef.current?.getBoundingClientRect();
        if (rect) {
          const x = e.clientX - rect.left + (scrollRef.current?.scrollLeft ?? 0) - GUTTER;
          setRangeSelection((prev) =>
            prev
              ? { ...prev, end: Math.max(0, x / pps), anchorX: e.clientX, anchorY: e.clientY }
              : null,
          );
        }
        return;
      }
      const marquee = marqueeRef.current;
      if (marquee) {
        const point = toContentPoint(e.clientX, e.clientY);
        if (!point) return;
        if (!marquee.active && !isMarqueeDrag(marquee.originX, marquee.originY, point.x, point.y)) {
          return;
        }
        marquee.active = true;
        const rect = getMarqueeRect(marquee.originX, marquee.originY, point.x, point.y);
        setMarqueeRect(rect);
        // Live selection: every clip the box currently covers. Shift held
        // mid-drag (or cmd/ctrl at pointerdown) adds to the prior selection.
        const additive = marquee.additive || e.shiftKey;
        const { ids, primaryId } = computeMarqueeSelection({
          clips: toMarqueeClips(elementsRef.current ?? []),
          trackOrder: trackOrderRef.current ?? [],
          pps: ppsRef.current,
          marquee: rect,
          baseSelection: additive ? marquee.baseIds : undefined,
        });
        const store = usePlayerStore.getState();
        store.setSelectedElementIds(ids);
        store.setSelectedElementId(primaryId ?? (additive ? marquee.basePrimary : null));
        return;
      }
      if (!isDragging.current) return;
      pendingClientXRef.current = e.clientX;
      // Update the playhead visual immediately via liveTime for smooth feedback,
      // then RAF-throttle the full seek (adapter + React state sync).
      const el = scrollRef.current;
      if (el) {
        const rect = el.getBoundingClientRect();
        const x = e.clientX - rect.left + el.scrollLeft - GUTTER;
        if (x >= 0) {
          const dur = el.scrollWidth / pps;
          liveTime.notify(Math.max(0, Math.min(dur, x / pps)));
        }
      }
      if (!seekRafRef.current) {
        seekRafRef.current = requestAnimationFrame(() => {
          seekRafRef.current = 0;
          if (isDragging.current) {
            seekFromX(pendingClientXRef.current);
            autoScrollDuringDrag(pendingClientXRef.current);
          }
        });
      }
    },
    [
      seekFromX,
      autoScrollDuringDrag,
      pps,
      scrollRef,
      isDragging,
      toContentPoint,
      elementsRef,
      trackOrderRef,
      ppsRef,
    ],
  );

  const handlePointerUp = useCallback(() => {
    if (isRangeSelecting.current) {
      isRangeSelecting.current = false;
      const pendingShiftClick = shiftClickClipRef.current;
      shiftClickClipRef.current = null;
      setRangeSelection((prev) => {
        if (prev && pendingShiftClick && Math.abs(prev.end - prev.start) <= 0.2) {
          setShowPopover(true);
          return buildClipRangeSelection(pendingShiftClick.element, pendingShiftClick);
        }
        if (prev && Math.abs(prev.end - prev.start) > 0.2) {
          setShowPopover(true);
          return prev;
        }
        return null;
      });
      return;
    }
    const marquee = marqueeRef.current;
    if (marquee) {
      marqueeRef.current = null;
      setMarqueeRect(null);
      const store = usePlayerStore.getState();
      if (!marquee.active) {
        // Plain click on empty body (click-away): deselect everything.
        store.setSelectedElementId(null);
        store.clearSelectedElementIds();
        onSelectElement?.(null);
        return;
      }
      // Drag released: keep the live selection, notify the primary element.
      const primaryKey = store.selectedElementId;
      const primary =
        (elementsRef.current ?? []).find((el) => (el.key ?? el.id) === primaryKey) ?? null;
      onSelectElement?.(primary);
      return;
    }
    if (!isDragging.current) return;
    if (seekRafRef.current) {
      cancelAnimationFrame(seekRafRef.current);
      seekRafRef.current = 0;
    }
    seekFromX(pendingClientXRef.current);
    isDragging.current = false;
    cancelAnimationFrame(dragScrollRaf.current);
  }, [isDragging, dragScrollRaf, setShowPopover, seekFromX, elementsRef, onSelectElement]);

  // Escape: cancel an in-flight marquee (restores the pre-drag selection);
  // otherwise clear any lingering multi-selection.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const store = usePlayerStore.getState();
      const marquee = marqueeRef.current;
      if (marquee) {
        marqueeRef.current = null;
        setMarqueeRect(null);
        if (marquee.active) {
          store.setSelectedElementIds(marquee.baseIds);
          store.setSelectedElementId(marquee.basePrimary);
        }
        return;
      }
      if (store.selectedElementIds.size > 0) {
        store.clearSelectedElementIds();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return {
    rangeSelection,
    setRangeSelection,
    shiftClickClipRef,
    marqueeRect,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
  };
}
