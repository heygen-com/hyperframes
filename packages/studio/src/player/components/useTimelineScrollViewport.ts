import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { useMountEffect } from "../../hooks/useMountEffect";
import { shouldShowTimelineShortcutHint } from "./timelineLayout";

/**
 * The timeline scroll container's viewport plumbing — extracted verbatim from
 * Timeline.tsx (600-line studio cap): the ResizeObserver-backed viewport width,
 * the rAF-throttled shortcut-hint visibility sync, and the callback ref that
 * wires both to the scroll element. `resyncShortcutHintOn` re-checks the hint
 * whenever any of its values change (timeline readiness / element count /
 * canvas height), matching the original effect.
 */
export function useTimelineScrollViewport(
  scrollRef: RefObject<HTMLDivElement | null>,
  resyncShortcutHintOn: ReadonlyArray<unknown>,
): {
  viewportWidth: number;
  showShortcutHint: boolean;
  setScrollRef: (el: HTMLDivElement | null) => void;
} {
  const [viewportWidth, setViewportWidth] = useState(0);
  const [showShortcutHint, setShowShortcutHint] = useState(true);
  const roRef = useRef<ResizeObserver | null>(null);
  const shortcutHintRafRef = useRef(0);

  const syncShortcutHintVisibility = useCallback(() => {
    const scroll = scrollRef.current;
    setShowShortcutHint(
      scroll ? shouldShowTimelineShortcutHint(scroll.scrollHeight, scroll.clientHeight) : true,
    );
  }, [scrollRef]);

  const scheduleShortcutHintVisibilitySync = useCallback(() => {
    if (shortcutHintRafRef.current) cancelAnimationFrame(shortcutHintRafRef.current);
    shortcutHintRafRef.current = requestAnimationFrame(() => {
      shortcutHintRafRef.current = 0;
      syncShortcutHintVisibility();
    });
  }, [syncShortcutHintVisibility]);

  const setScrollRef = useCallback(
    (el: HTMLDivElement | null) => {
      if (roRef.current) {
        roRef.current.disconnect();
        roRef.current = null;
      }
      scrollRef.current = el;
      if (!el) return;

      const syncScrollViewport = () => {
        setViewportWidth(el.clientWidth);
        scheduleShortcutHintVisibilitySync();
      };

      syncScrollViewport();
      roRef.current = new ResizeObserver(syncScrollViewport);
      roRef.current.observe(el);
    },
    [scrollRef, scheduleShortcutHintVisibilitySync],
  );

  useMountEffect(() => () => {
    roRef.current?.disconnect();
    if (shortcutHintRafRef.current) cancelAnimationFrame(shortcutHintRafRef.current);
  });

  useEffect(() => {
    syncShortcutHintVisibility();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncShortcutHintVisibility, ...resyncShortcutHintOn]);

  return { viewportWidth, showShortcutHint, setScrollRef };
}
