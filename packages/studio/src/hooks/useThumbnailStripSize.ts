import { useCallback, useRef, useState } from "react";
import { useMountEffect } from "./useMountEffect";

interface StripSize {
  width: number;
  height: number;
  inViewStart: number;
  inViewEnd: number;
}

const IN_VIEW_CHUNK_PX = 512;

const measure = (target: Element, width: number, height: number) => (prev: StripSize) => {
  const left = target.getBoundingClientRect().left;
  const inViewStart = Math.max(
    0,
    Math.floor((-left - IN_VIEW_CHUNK_PX) / IN_VIEW_CHUNK_PX) * IN_VIEW_CHUNK_PX,
  );
  const inViewEnd = Math.max(
    0,
    Math.ceil((window.innerWidth - left + IN_VIEW_CHUNK_PX) / IN_VIEW_CHUNK_PX) * IN_VIEW_CHUNK_PX,
  );
  return prev.width === width &&
    prev.height === height &&
    prev.inViewStart === inViewStart &&
    prev.inViewEnd === inViewEnd
    ? prev
    : { width, height, inViewStart, inViewEnd };
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
    setSize(measure(target, target.clientWidth, target.clientHeight));
    const observer = new ResizeObserver(([entry]) =>
      setSize(measure(target, entry.contentRect.width, entry.contentRect.height)),
    );
    observer.observe(target);
    let frame = 0;
    const remeasure = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        setSize((prev) => measure(target, prev.width, prev.height)(prev));
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
