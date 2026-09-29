import { useCallback, useRef, useState } from "react";
import { useMountEffect } from "./useMountEffect";

interface StripSize {
  width: number;
  height: number;
}

const resize = (width: number, height: number) => (prev: StripSize) =>
  prev.width === width && prev.height === height ? prev : { width, height };

/** Size of the thumbnail's parent, kept current by a ResizeObserver; 0x0 until measured. */
export function useThumbnailStripSize() {
  const [size, setSize] = useState<StripSize>({ width: 0, height: 0 });
  const observerRef = useRef<ResizeObserver | null>(null);

  const ref = useCallback((element: HTMLDivElement | null) => {
    observerRef.current?.disconnect();
    if (!element) return;
    const target = element.parentElement ?? element;
    setSize(resize(target.clientWidth, target.clientHeight));
    observerRef.current = new ResizeObserver(([entry]) =>
      setSize(resize(entry.contentRect.width, entry.contentRect.height)),
    );
    observerRef.current.observe(target);
  }, []);

  useMountEffect(() => () => observerRef.current?.disconnect());

  return [size, ref] as const;
}
