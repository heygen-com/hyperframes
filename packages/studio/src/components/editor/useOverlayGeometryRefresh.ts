import { useCallback, useEffect, useRef, type MutableRefObject, type RefObject } from "react";
import { useMountEffect } from "../../hooks/useMountEffect";
import type { OverlayFrameLoop } from "./overlayFrameLoop";
import { startPreviewDomWatch, type PreviewDomWatch } from "./previewDomWatch";

export interface OverlayGeometryRefresh {
  /** Handles the overlay loops register themselves in, so they can be re-armed. */
  rectsLoopRef: MutableRefObject<OverlayFrameLoop | null>;
  compRectLoopRef: MutableRefObject<OverlayFrameLoop | null>;
  offCanvasLoopRef: MutableRefObject<OverlayFrameLoop | null>;
  offCanvasDirtyRef: MutableRefObject<boolean>;
  refreshOverlayGeometry: () => void;
}

/**
 * The single answer to "what re-arms the canvas overlay loops".
 *
 * Each loop parks the moment it has caught up, so anything that can move what
 * they draw has to say so. Everything that can routes through the one function
 * returned here: the shared preview-document observer (which this hook owns),
 * React swapping the preview iframe element, and — from the caller, which is
 * where those values live — a stage zoom/pan or panel resize landing as a new
 * composition rect, and a composition switch.
 */
export function useOverlayGeometryRefresh(
  iframeRef: RefObject<HTMLIFrameElement | null>,
): OverlayGeometryRefresh {
  const rectsLoopRef = useRef<OverlayFrameLoop | null>(null);
  const compRectLoopRef = useRef<OverlayFrameLoop | null>(null);
  const offCanvasLoopRef = useRef<OverlayFrameLoop | null>(null);
  const offCanvasDirtyRef = useRef(true);

  const refreshOverlayGeometry = useCallback(() => {
    offCanvasDirtyRef.current = true;
    rectsLoopRef.current?.arm();
    compRectLoopRef.current?.arm();
    offCanvasLoopRef.current?.arm();
  }, []);

  const previewWatchRef = useRef<PreviewDomWatch | null>(null);
  useMountEffect(() => {
    const watch = startPreviewDomWatch(iframeRef, refreshOverlayGeometry);
    previewWatchRef.current = watch;
    return () => {
      watch.dispose();
      previewWatchRef.current = null;
    };
  });

  // The preview iframe element arrives in a ref, so React swapping it announces
  // itself to nobody: every render re-checks. The check is two identity
  // comparisons and schedules a frame only when something actually changed.
  useEffect(() => {
    previewWatchRef.current?.poll();
  });

  return {
    rectsLoopRef,
    compRectLoopRef,
    offCanvasLoopRef,
    offCanvasDirtyRef,
    refreshOverlayGeometry,
  };
}
