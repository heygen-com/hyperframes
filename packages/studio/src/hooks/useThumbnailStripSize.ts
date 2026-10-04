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

const EMPTY_STRIP: StripSize = { width: 0, height: 0, inViewStart: 0, inViewEnd: 0 };

// Clamped to a measured strip, so a scroll changes only strips crossing the screen's edge.
const merge = (prev: StripSize, patch: Partial<StripSize>): StripSize => {
  const next = { ...prev, ...patch };
  const width = next.width > 0 ? Math.ceil(next.width) : Infinity;
  next.inViewStart = Math.min(next.inViewStart, width);
  next.inViewEnd = Math.min(next.inViewEnd, width);
  return (Object.keys(next) as (keyof StripSize)[]).every((key) => next[key] === prev[key])
    ? prev
    : next;
};

type Apply = (patch: Partial<StripSize>) => void;

// A scroll re-measures only strips near the screen, reading all of them before one commit.
const strips = new Map<Element, Apply>();
const near = new Set<Element>();
let users = 0;
let frame = 0;
let shared: {
  resize: ResizeObserver;
  presence: IntersectionObserver | null;
  gaps: IntersectionObserver | null;
} | null = null;

const measure = (targets: Iterable<Element>) =>
  flushSync(() =>
    [...targets]
      .flatMap((target) => {
        const apply = strips.get(target);
        return apply ? [[apply, spanInView(target)] as const] : [];
      })
      .forEach(([apply, span]) => apply(span)),
  );

const refreshNear = () => {
  frame = 0;
  measure(shared?.presence ? near : strips.keys());
};

const scheduleRefresh = () => {
  if (!frame) frame = requestAnimationFrame(refreshNear);
};

const onPresence = (entries: IntersectionObserverEntry[]) => {
  for (const entry of entries) {
    if (entry.isIntersecting) near.add(entry.target);
    else near.delete(entry.target);
  }
  measure(entries.filter((entry) => entry.isIntersecting).map((entry) => entry.target));
};

const onResize = (entries: ResizeObserverEntry[]) => {
  const updates = entries.flatMap((entry) => {
    const apply = strips.get(entry.target);
    if (!apply) return [];
    const { width, height } = entry.contentRect;
    return [[apply, { width, height, ...spanInView(entry.target) }] as const];
  });
  flushSync(() => updates.forEach(([apply, patch]) => apply(patch)));
};

const observeIntersections = (callback: IntersectionObserverCallback) =>
  typeof IntersectionObserver === "undefined"
    ? null
    : new IntersectionObserver(callback, GAP_WARNING);

function acquire() {
  if (users++ === 0) {
    shared = {
      resize: new ResizeObserver(onResize),
      presence: observeIntersections(onPresence),
      gaps: observeIntersections(
        (entries) => entries.some((entry) => entry.isIntersecting) && scheduleRefresh(),
      ),
    };
    window.addEventListener("scroll", scheduleRefresh, { capture: true, passive: true });
  }
  return shared!;
}

function release() {
  if (--users > 0) return;
  shared?.resize.disconnect();
  shared?.presence?.disconnect();
  shared?.gaps?.disconnect();
  shared = null;
  near.clear();
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
  const [size, setSize] = useState(EMPTY_STRIP);

  const ref = useCallback((element: HTMLDivElement | null) => {
    if (!element) return;
    const target = element.parentElement ?? element;
    const { resize, presence } = acquire();
    let current = EMPTY_STRIP;
    const apply: Apply = (patch) => {
      const next = merge(current, patch);
      if (next === current) return;
      current = next;
      setSize(next);
    };
    strips.set(target, apply);
    apply({ width: target.clientWidth, height: target.clientHeight, ...spanInView(target) });
    resize.observe(target);
    presence?.observe(target);
    return () => {
      resize.unobserve(target);
      presence?.unobserve(target);
      near.delete(target);
      strips.delete(target);
      release();
    };
  }, []);

  return [size, ref, watchGap] as const;
}
