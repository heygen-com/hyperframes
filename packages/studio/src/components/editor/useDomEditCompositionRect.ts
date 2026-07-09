import { useState, type RefObject } from "react";
import { useMountEffect } from "../../hooks/useMountEffect";
import { resolvePreviewCoordinateSpace } from "../../utils/previewCoordinates";

export interface DomEditCompositionRect {
  left: number;
  top: number;
  width: number;
  height: number;
  scaleX: number;
  scaleY: number;
}

function sameRect(a: DomEditCompositionRect, b: DomEditCompositionRect): boolean {
  const d = (k: keyof DomEditCompositionRect) => Math.abs(a[k] - b[k]);
  return (
    d("left") < 0.5 &&
    d("top") < 0.5 &&
    d("width") < 0.5 &&
    d("height") < 0.5 &&
    d("scaleX") < 0.001 &&
    d("scaleY") < 0.001
  );
}

export function useDomEditCompositionRect({
  iframeRef,
  overlayRef,
}: {
  iframeRef: RefObject<HTMLIFrameElement | null>;
  overlayRef: RefObject<HTMLDivElement | null>;
}): DomEditCompositionRect {
  const [compRect, setCompRect] = useState({
    left: 0,
    top: 0,
    width: 0,
    height: 0,
    scaleX: 1,
    scaleY: 1,
  });

  useMountEffect(() => {
    let frame = 0;
    // fallow-ignore-next-line complexity
    const update = () => {
      frame = requestAnimationFrame(update);
      const iframe = iframeRef.current;
      const overlayEl = overlayRef.current;
      if (!iframe || !overlayEl) return;
      const space = resolvePreviewCoordinateSpace(iframe);
      if (!space) return;
      const oRect = overlayEl.getBoundingClientRect();
      const next = {
        left: space.iframeRect.left - oRect.left,
        top: space.iframeRect.top - oRect.top,
        width: space.iframeRect.width,
        height: space.iframeRect.height,
        scaleX: space.scaleX,
        scaleY: space.scaleY,
      };
      setCompRect((prev) => (sameRect(prev, next) ? prev : next));
    };
    frame = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frame);
  });

  return compRect;
}
