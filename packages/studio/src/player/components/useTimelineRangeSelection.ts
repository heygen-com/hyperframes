import { useRef, useState, useCallback, useEffect } from "react";
import {
  buildClipRangeSelection,
  applyTimelineAutoScrollStep,
  resolveTimelineAutoScrollLoopAction,
  type TimelineRangeSelection,
} from "./timelineEditing";
import type { TimelineElement } from "../store/playerStore";
import { liveTime, usePlayerStore } from "../store/playerStore";
import { GUTTER } from "./timelineLayout";
import {
  computeMarqueeSelection,
  getMarqueeRect,
  isMarqueeDrag,
  isTimelineRulerPress,
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

/**
 * Compute the live selection for a marquee rect and commit it to the store.
 * Shift held mid-drag (or cmd/ctrl at pointerdown) unions the new hits with the
 * pre-drag selection (marquee.baseIds / basePrimary).
 */
function commitMarqueeSelection(
  rect: Rect,
  additive: boolean,
  marquee: MarqueeDragState,
  elements: TimelineElement[],
  trackOrder: number[],
  pps: number,
): void {
  const { ids, primaryId } = computeMarqueeSelection({
    clips: toMarqueeClips(elements),
    trackOrder,
    pps,
    marquee: rect,
    baseSelection: additive ? marquee.baseIds : undefined,
  });
  const store = usePlayerStore.getState();
  // Primary FIRST: setSelectedElementId collapses the multi-select set, so the set
  // must be written after it or the marquee selection would be wiped every frame.
  store.setSelectedElementId(primaryId ?? (additive ? marquee.basePrimary : null));
  store.setSelectedElementIds(ids);
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
  // Reactive mirror of the scrub gesture (isDragging is a ref, so it can't drive
  // rendering). Drives the playhead head's filled-vs-hollow state.
  const [isScrubbing, setIsScrubbing] = useState(false);
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
  // Edge auto-scroll during a marquee drag: last pointer position (client-space)
  // + shift flag, re-applied each RAF frame while the view scrolls under a
  // stationary pointer, so the marquee can extend past the visible area.
  const marqueePointerRef = useRef<{ clientX: number; clientY: number; shiftKey: boolean } | null>(
    null,
  );
  const marqueeScrollRaf = useRef(0);

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

  // Recompute the marquee rect + live selection for a client-space pointer.
  // Content-space (folds in scrollLeft/scrollTop), so re-running it after the
  // view scrolls naturally extends the rect toward the newly revealed area.
  // Shared by the pointermove handler and the edge auto-scroll stepper.
  const applyMarqueeAtClient = useCallback(
    (clientX: number, clientY: number, shiftKey: boolean) => {
      const marquee = marqueeRef.current;
      if (!marquee) return;
      const point = toContentPoint(clientX, clientY);
      if (!point) return;
      if (!marquee.active && !isMarqueeDrag(marquee.originX, marquee.originY, point.x, point.y)) {
        return;
      }
      marquee.active = true;
      const rect = getMarqueeRect(marquee.originX, marquee.originY, point.x, point.y);
      setMarqueeRect(rect);
      // Live selection: every clip the box currently covers. Shift held
      // mid-drag (or cmd/ctrl at pointerdown) adds to the prior selection.
      const additive = marquee.additive || shiftKey;
      commitMarqueeSelection(
        rect,
        additive,
        marquee,
        elementsRef.current ?? [],
        trackOrderRef.current ?? [],
        ppsRef.current,
      );
    },
    [toContentPoint, elementsRef, trackOrderRef, ppsRef],
  );

  const stopMarqueeAutoScroll = useCallback(() => {
    marqueePointerRef.current = null;
    if (marqueeScrollRaf.current) {
      cancelAnimationFrame(marqueeScrollRaf.current);
      marqueeScrollRaf.current = 0;
    }
  }, []);

  // Edge auto-scroll while marquee-dragging: mirrors stepClipDragAutoScroll —
  // scroll the container toward the edge zone the pointer is in, then re-run the
  // marquee at the (unchanged) client pointer so the rect + selection extend
  // under the scroll delta. Self-perpetuating RAF until the pointer leaves the
  // edge zones or the gesture ends.
  const stepMarqueeAutoScroll = useCallback(() => {
    marqueeScrollRaf.current = 0;
    const marquee = marqueeRef.current;
    const pointer = marqueePointerRef.current;
    const scroll = scrollRef.current;
    if (!marquee || !pointer || !scroll) return;
    if (!applyTimelineAutoScrollStep(scroll, pointer.clientX, pointer.clientY)) return;

    // Re-run at the SAME client point: toContentPoint folds in the new scroll, so
    // the marquee's moving corner tracks the revealed content.
    applyMarqueeAtClient(pointer.clientX, pointer.clientY, pointer.shiftKey);
    marqueeScrollRaf.current = requestAnimationFrame(stepMarqueeAutoScroll);
  }, [scrollRef, applyMarqueeAtClient]);

  const syncMarqueeAutoScroll = useCallback(
    (clientX: number, clientY: number, shiftKey: boolean) => {
      marqueePointerRef.current = { clientX, clientY, shiftKey };
      const action = resolveTimelineAutoScrollLoopAction(
        scrollRef.current,
        clientX,
        clientY,
        marqueeScrollRaf.current !== 0,
      );
      if (action === "stop") {
        cancelAnimationFrame(marqueeScrollRaf.current);
        marqueeScrollRaf.current = 0;
      } else if (action === "start") {
        marqueeScrollRaf.current = requestAnimationFrame(stepMarqueeAutoScroll);
      }
    },
    [scrollRef, stepMarqueeAutoScroll],
  );

  // Shift-press → start a time-range selection anchored at the pressed x.
  const beginRangeSelection = useCallback(
    (e: React.PointerEvent) => {
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
    },
    [scrollRef, pps, setShowPopover],
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      if (e.shiftKey) {
        beginRangeSelection(e);
        return;
      }
      shiftClickClipRef.current = null;
      if ((e.target as HTMLElement).closest("[data-clip]")) return;
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      setRangeSelection(null);
      setShowPopover(false);
      const point = toContentPoint(e.clientX, e.clientY);
      // Ruler press → scrub the playhead (the standard scrub surface). The
      // ruler is sticky, so this decision uses VIEWPORT-space y — content-space
      // y (which folds in scrollTop) breaks once the body is scrolled down and
      // the stuck ruler visually overlays scrolled-away track rows.
      const scrollRect = scrollRef.current?.getBoundingClientRect();
      if (!point || !scrollRect || isTimelineRulerPress(e.clientY, scrollRect.top)) {
        isDragging.current = true;
        setIsScrubbing(true);
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
    [beginRangeSelection, seekFromX, scrollRef, isDragging, setShowPopover, toContentPoint],
  );

  // Scrub-drag update: live playhead feedback (liveTime) + RAF-throttled seek.
  const updateScrubDrag = useCallback(
    (clientX: number) => {
      pendingClientXRef.current = clientX;
      // Update the playhead visual immediately via liveTime for smooth feedback,
      // then RAF-throttle the full seek (adapter + React state sync).
      const el = scrollRef.current;
      if (el) {
        const rect = el.getBoundingClientRect();
        const x = clientX - rect.left + el.scrollLeft - GUTTER;
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
    [scrollRef, pps, seekFromX, autoScrollDuringDrag, isDragging],
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
        applyMarqueeAtClient(e.clientX, e.clientY, e.shiftKey);
        // Edge auto-scroll: once the drag is live, scroll when the pointer nears
        // a viewport edge so the marquee can extend past the visible area.
        if (marquee.active) syncMarqueeAutoScroll(e.clientX, e.clientY, e.shiftKey);
        return;
      }
      if (!isDragging.current) return;
      updateScrubDrag(e.clientX);
    },
    [pps, scrollRef, isDragging, applyMarqueeAtClient, syncMarqueeAutoScroll, updateScrubDrag],
  );

  // Release of a shift time-range gesture: keep a real range (or a shift-click
  // clip range), otherwise clear it.
  const finishRangeSelection = useCallback(() => {
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
  }, [setShowPopover]);

  // Release of a marquee gesture: plain click deselects; a real drag keeps the
  // live selection and notifies the primary element.
  const finishMarquee = useCallback(
    (marquee: MarqueeDragState) => {
      marqueeRef.current = null;
      stopMarqueeAutoScroll();
      setMarqueeRect(null);
      const store = usePlayerStore.getState();
      if (!marquee.active) {
        // Plain click on empty body (click-away): deselect everything.
        store.setSelectedElementId(null);
        store.clearSelectedElementIds();
        onSelectElement?.(null);
        return;
      }
      const primaryKey = store.selectedElementId;
      const primary =
        (elementsRef.current ?? []).find((el) => (el.key ?? el.id) === primaryKey) ?? null;
      onSelectElement?.(primary);
    },
    [stopMarqueeAutoScroll, elementsRef, onSelectElement],
  );

  const handlePointerUp = useCallback(() => {
    if (isRangeSelecting.current) {
      finishRangeSelection();
      return;
    }
    const marquee = marqueeRef.current;
    if (marquee) {
      finishMarquee(marquee);
      return;
    }
    if (!isDragging.current) return;
    if (seekRafRef.current) {
      cancelAnimationFrame(seekRafRef.current);
      seekRafRef.current = 0;
    }
    seekFromX(pendingClientXRef.current);
    isDragging.current = false;
    setIsScrubbing(false);
    cancelAnimationFrame(dragScrollRaf.current);
  }, [isDragging, dragScrollRaf, seekFromX, finishRangeSelection, finishMarquee]);

  // Escape: cancel an in-flight marquee (restores the pre-drag selection);
  // otherwise clear any lingering multi-selection.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const store = usePlayerStore.getState();
      const marquee = marqueeRef.current;
      if (marquee) {
        marqueeRef.current = null;
        stopMarqueeAutoScroll();
        setMarqueeRect(null);
        if (marquee.active) {
          // Primary FIRST (see commitMarqueeSelection): it collapses the set, so
          // restore the pre-drag primary before repopulating the base ids.
          store.setSelectedElementId(marquee.basePrimary);
          store.setSelectedElementIds(marquee.baseIds);
        }
        return;
      }
      // Escape with no marquee clears the whole selection — primary AND set.
      // setSelectedElementId(null) also collapses the multi-select set.
      if (store.selectedElementId || store.selectedElementIds.size > 0) {
        store.setSelectedElementId(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [stopMarqueeAutoScroll]);

  return {
    rangeSelection,
    setRangeSelection,
    shiftClickClipRef,
    marqueeRect,
    isScrubbing,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
  };
}
