import { useCallback, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useMountEffect } from "./useMountEffect";

export interface StripSize {
  width: number;
  height: number;
  inViewStart: number;
  inViewEnd: number;
}

const IN_VIEW_CHUNK_PX = 512;

const chunk = (px: number, round: (n: number) => number) =>
  Math.max(0, round(px / IN_VIEW_CHUNK_PX) * IN_VIEW_CHUNK_PX);

const spanInView = (target: Element) => {
  const left = target.getBoundingClientRect().left;
  return {
    inViewStart: chunk(-left - IN_VIEW_CHUNK_PX, Math.floor),
    inViewEnd: chunk(window.innerWidth - left + IN_VIEW_CHUNK_PX, Math.ceil),
  };
};

// scrollMargin widens the band inside the timeline's own scroller too; TypeScript's DOM types lack it.
const GAP_WARNING: IntersectionObserverInit & { scrollMargin: string } = {
  rootMargin: `0px ${IN_VIEW_CHUNK_PX / 2}px`,
  scrollMargin: `0px ${IN_VIEW_CHUNK_PX / 2}px`,
};

const merge = (patch: Partial<StripSize>) => (prev: StripSize) => {
  const next = { ...prev, ...patch };
  return (Object.keys(next) as (keyof StripSize)[]).every((key) => next[key] === prev[key])
    ? prev
    : next;
};

/**
 * Size of the thumbnail's parent and its span in the window. Scroll and resize keep it current; `watchGap` goes on
 * the strip's unmounted ends and re-measures whenever one nears the screen, whatever moved it.
 */
export function useThumbnailStripSize() {
  const [size, setSize] = useState<StripSize>({
    width: 0,
    height: 0,
    inViewStart: 0,
    inViewEnd: 0,
  });
  const targetRef = useRef<Element | null>(null);
  const frameRef = useRef(0);
  const cleanupRef = useRef<(() => void) | null>(null);

  const remeasure = useCallback(() => {
    if (frameRef.current) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = 0;
      const target = targetRef.current;
      if (target) flushSync(() => setSize(merge(spanInView(target))));
    });
  }, []);

  const [gaps] = useState(() =>
    typeof IntersectionObserver === "undefined"
      ? null
      : new IntersectionObserver(
          (entries) => entries.some((entry) => entry.isIntersecting) && remeasure(),
          GAP_WARNING,
        ),
  );

  const watchGap = useCallback(
    (gap: HTMLDivElement | null) => {
      if (!gap || !gaps) return;
      gaps.observe(gap);
      return () => gaps.unobserve(gap);
    },
    [gaps],
  );

  const ref = useCallback(
    (element: HTMLDivElement | null) => {
      cleanupRef.current?.();
      cleanupRef.current = null;
      targetRef.current = null;
      if (!element) return;
      const target = element.parentElement ?? element;
      targetRef.current = target;
      setSize(
        merge({ width: target.clientWidth, height: target.clientHeight, ...spanInView(target) }),
      );
      const observer = new ResizeObserver(([entry]) =>
        flushSync(() =>
          setSize(
            merge({
              width: entry.contentRect.width,
              height: entry.contentRect.height,
              ...spanInView(target),
            }),
          ),
        ),
      );
      observer.observe(target);
      window.addEventListener("scroll", remeasure, { capture: true, passive: true });
      cleanupRef.current = () => {
        observer.disconnect();
        window.removeEventListener("scroll", remeasure, { capture: true });
      };
    },
    [remeasure],
  );

  useMountEffect(() => () => {
    cleanupRef.current?.();
    cancelAnimationFrame(frameRef.current);
    frameRef.current = 0;
    gaps?.disconnect();
  });

  return [size, ref, watchGap] as const;
}
