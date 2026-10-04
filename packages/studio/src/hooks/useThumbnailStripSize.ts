import { useCallback, useState } from "react";
import { flushSync } from "react-dom";

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

type Apply = (patch: Partial<StripSize>) => void;

// Every strip shares one listener set and one frame: all positions are read, then all updates
// commit together, so a timeline of many clips lays out once per frame, not once per clip.
const strips = new Map<Element, Apply>();
let users = 0;
let frame = 0;
let shared: { resize: ResizeObserver; gaps: IntersectionObserver | null } | null = null;

const applyAll = (updates: [Apply, Partial<StripSize>][]) =>
  flushSync(() => updates.forEach(([apply, patch]) => apply(patch)));

const refreshAll = () => {
  frame = 0;
  applyAll([...strips].map(([target, apply]) => [apply, spanInView(target)]));
};

const scheduleRefresh = () => {
  if (!frame) frame = requestAnimationFrame(refreshAll);
};

const onResize = (entries: ResizeObserverEntry[]) =>
  applyAll(
    entries.flatMap((entry) => {
      const apply = strips.get(entry.target);
      if (!apply) return [];
      const { width, height } = entry.contentRect;
      return [[apply, { width, height, ...spanInView(entry.target) }]];
    }),
  );

function acquire() {
  if (users++ === 0) {
    shared = {
      resize: new ResizeObserver(onResize),
      gaps:
        typeof IntersectionObserver === "undefined"
          ? null
          : new IntersectionObserver(
              (entries) => entries.some((entry) => entry.isIntersecting) && scheduleRefresh(),
              GAP_WARNING,
            ),
    };
    window.addEventListener("scroll", scheduleRefresh, { capture: true, passive: true });
  }
  return shared!;
}

function release() {
  if (--users > 0) return;
  shared?.resize.disconnect();
  shared?.gaps?.disconnect();
  shared = null;
  window.removeEventListener("scroll", scheduleRefresh, { capture: true });
  cancelAnimationFrame(frame);
  frame = 0;
}

const watchGap = (gap: HTMLDivElement | null) => {
  if (!gap) return;
  const { gaps } = acquire();
  gaps?.observe(gap);
  return () => {
    gaps?.unobserve(gap);
    release();
  };
};

/** Size of the thumbnail's parent and its span in the window, kept current on resize, scroll and moves. */
export function useThumbnailStripSize() {
  const [size, setSize] = useState<StripSize>({
    width: 0,
    height: 0,
    inViewStart: 0,
    inViewEnd: 0,
  });

  const ref = useCallback((element: HTMLDivElement | null) => {
    if (!element) return;
    const target = element.parentElement ?? element;
    const { resize } = acquire();
    strips.set(target, (patch) => setSize(merge(patch)));
    setSize(
      merge({ width: target.clientWidth, height: target.clientHeight, ...spanInView(target) }),
    );
    resize.observe(target);
    return () => {
      resize.unobserve(target);
      strips.delete(target);
      release();
    };
  }, []);

  return [size, ref, watchGap] as const;
}
