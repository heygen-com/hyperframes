import type React from "react";
import type { OffCanvasRect } from "./OffCanvasIndicators";
import { recomputeOffCanvasIndicators } from "./offCanvasIndicatorGeometry";
import { createOverlayFrameLoop, type OverlayFrameLoop } from "./overlayFrameLoop";

interface OffCanvasIndicatorRefreshOptions {
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
  overlayRef: React.RefObject<HTMLDivElement | null>;
  compRectRef: React.MutableRefObject<{ left: number; top: number; width: number; height: number }>;
  activeCompositionPathRef: React.MutableRefObject<string | null>;
  dirtyRef: React.MutableRefObject<boolean>;
  sigRef: React.MutableRefObject<string>;
  observedDocRef: React.MutableRefObject<Document | null>;
  elementsRef: React.MutableRefObject<Map<string, HTMLElement>>;
  /** Filled with this loop so the overlay can re-arm it; see DomEditOverlay. */
  loopRef: React.MutableRefObject<OverlayFrameLoop | null>;
  setRects: (rects: OffCanvasRect[]) => void;
}

function compSignature(comp: { left: number; top: number; width: number; height: number }): string {
  return `${Math.round(comp.left)}:${Math.round(comp.top)}:${Math.round(comp.width)}:${Math.round(comp.height)}`;
}

function clearIndicators(options: OffCanvasIndicatorRefreshOptions): void {
  options.dirtyRef.current = false;
  options.sigRef.current = "";
  options.elementsRef.current = new Map();
  options.setRects([]);
}

/**
 * Recomputes the off-canvas indicators when the preview DOM has moved.
 *
 * The loop parks as soon as it has caught up; it is re-armed by
 * `refreshOverlayGeometry` in DomEditOverlay, which is what the shared
 * preview-document observer, a composition switch and a composition-rect change
 * all route through.
 */
export function startOffCanvasIndicatorRefresh(
  options: OffCanvasIndicatorRefreshOptions,
): () => void {
  let lastCompSig = "";
  const update = (): boolean => {
    const iframe = options.iframeRef.current;
    const overlayEl = options.overlayRef.current;
    const doc = iframe?.contentDocument ?? null;
    if (doc !== options.observedDocRef.current) {
      options.observedDocRef.current = doc;
      options.sigRef.current = "";
      options.dirtyRef.current = true;
    }
    const comp = options.compRectRef.current;
    const nextCompSig = compSignature(comp);
    if (nextCompSig !== lastCompSig) {
      lastCompSig = nextCompSig;
      options.dirtyRef.current = true;
    }
    if (!iframe || !overlayEl) {
      if (options.dirtyRef.current) clearIndicators(options);
      return false;
    }
    if (!options.dirtyRef.current) return false;
    options.dirtyRef.current = false;
    recomputeOffCanvasIndicators(
      iframe,
      overlayEl,
      doc,
      comp,
      options.activeCompositionPathRef.current,
      options.sigRef,
      options.elementsRef,
      options.setRects,
    );
    return false;
  };
  const loop = createOverlayFrameLoop(update);
  options.loopRef.current = loop;
  loop.arm();
  return () => {
    loop.stop();
    options.loopRef.current = null;
    options.observedDocRef.current = null;
  };
}
