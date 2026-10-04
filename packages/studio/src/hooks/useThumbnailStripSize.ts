import { useCallback, useRef, useState } from "react";
import { useMountEffect } from "./useMountEffect";

interface StripSize {
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

const merge = (patch: Partial<StripSize>) => (prev: StripSize) => {
  const next = { ...prev, ...patch };
  return (Object.keys(next) as (keyof StripSize)[]).every((key) => next[key] === prev[key])
    ? prev
    : next;
};

/** Size of the thumbnail's parent and its span in the window; kept current on resize, scroll and clip moves. */
export function useThumbnailStripSize() {
  const [size, setSize] = useState<StripSize>({
    width: 0,
    height: 0,
    inViewStart: 0,
    inViewEnd: 0,
  });
  const cleanupRef = useRef<(() => void) | null>(null);

  const ref = useCallback((element: HTMLDivElement | null) => {
    cleanupRef.current?.();
    cleanupRef.current = null;
    if (!element) return;
    const target = element.parentElement ?? element;
    setSize(
      merge({ width: target.clientWidth, height: target.clientHeight, ...spanInView(target) }),
    );
    const observer = new ResizeObserver(([entry]) =>
      setSize(
        merge({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
          ...spanInView(target),
        }),
      ),
    );
    observer.observe(target);
    let frame = 0;
    const remeasure = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        setSize(merge(spanInView(target)));
      });
    };
    const clip = target.closest(".timeline-clip");
    const moved = new MutationObserver(remeasure);
    if (clip) moved.observe(clip, { attributes: true, attributeFilter: ["style"] });
    window.addEventListener("scroll", remeasure, { capture: true, passive: true });
    window.addEventListener("resize", remeasure, { passive: true });
    cleanupRef.current = () => {
      observer.disconnect();
      moved.disconnect();
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", remeasure, { capture: true });
      window.removeEventListener("resize", remeasure);
    };
  }, []);

  useMountEffect(() => () => cleanupRef.current?.());

  return [size, ref] as const;
}
