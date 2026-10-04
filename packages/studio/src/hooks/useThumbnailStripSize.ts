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

const spanAt = (left: number) => ({
  inViewStart: chunk(-left - IN_VIEW_CHUNK_PX, Math.floor),
  inViewEnd: chunk(window.innerWidth - left + IN_VIEW_CHUNK_PX, Math.ceil),
});

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

interface Strip {
  apply: Apply;
  scroller: Element | null;
  box: { left: number; top: number; width: number; height: number };
}

const NEAR_PX = IN_VIEW_CHUNK_PX / 2;

// Each frame moves every strip's last box by its scroller's offset change and reads only the boxes
// that land near the screen, so a jump costs what a short scroll does; all reads precede one commit.
const strips = new Map<Element, Strip>();
const offsets = new Map<Element | null, { x: number; y: number }>();
let users = 0;
let frame = 0;
let shared: {
  resize: ResizeObserver;
  presence: IntersectionObserver | null;
  gaps: IntersectionObserver | null;
} | null = null;

const offsetOf = (scroller: Element | null) =>
  scroller ? { x: scroller.scrollLeft, y: scroller.scrollTop } : { x: scrollX, y: scrollY };

const read = (target: Element, strip: Strip) => {
  const { left, top, width, height } = target.getBoundingClientRect();
  strip.box = { left, top, width, height };
  return spanAt(left);
};

const isNear = ({ left, top, width, height }: Strip["box"]) =>
  left < innerWidth + NEAR_PX &&
  left + width > -NEAR_PX &&
  top < innerHeight + NEAR_PX &&
  top + height > -NEAR_PX;

const commit = (updates: (readonly [Apply, Partial<StripSize>])[]) =>
  flushSync(() => updates.forEach(([apply, patch]) => apply(patch)));

const refresh = () => {
  frame = 0;
  const moved = new Map<Element | null, { x: number; y: number }>();
  for (const [scroller, last] of offsets) {
    const now = offsetOf(scroller);
    moved.set(scroller, { x: now.x - last.x, y: now.y - last.y });
    offsets.set(scroller, now);
  }
  const updates = [...strips].map(([target, strip]) => {
    const shift = moved.get(strip.scroller);
    if (shift)
      strip.box = { ...strip.box, left: strip.box.left - shift.x, top: strip.box.top - shift.y };
    return [strip.apply, isNear(strip.box) ? read(target, strip) : spanAt(strip.box.left)] as const;
  });
  commit(updates);
};

const scheduleRefresh = () => {
  if (!frame) frame = requestAnimationFrame(refresh);
};

const measure = (entries: { target: Element; size?: { width: number; height: number } }[]) =>
  commit(
    entries.flatMap(({ target, size }) => {
      const strip = strips.get(target);
      return strip ? [[strip.apply, { ...size, ...read(target, strip) }] as const] : [];
    }),
  );

const onPresence = (entries: IntersectionObserverEntry[]) =>
  measure(entries.filter((entry) => entry.isIntersecting));

const onResize = (entries: ResizeObserverEntry[]) =>
  measure(
    entries.map(({ target, contentRect: { width, height } }) => ({
      target,
      size: { width, height },
    })),
  );

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
  offsets.clear();
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
    const scroller = target.closest("[data-timeline-scroll-viewport]");
    if (!offsets.has(scroller)) offsets.set(scroller, offsetOf(scroller));
    const strip: Strip = { apply, scroller, box: { left: 0, top: 0, width: 0, height: 0 } };
    strips.set(target, strip);
    apply({ width: target.clientWidth, height: target.clientHeight, ...read(target, strip) });
    resize.observe(target);
    presence?.observe(target);
    return () => {
      resize.unobserve(target);
      presence?.unobserve(target);
      strips.delete(target);
      release();
    };
  }, []);

  return [size, ref, watchGap] as const;
}
