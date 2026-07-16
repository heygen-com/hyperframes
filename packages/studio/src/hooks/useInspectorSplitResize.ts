import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { readStudioUiPreferences, writeStudioUiPreferences } from "../utils/studioUiPreferences";

const MIN_INSPECTOR_SPLIT_PERCENT = 20;
const MAX_INSPECTOR_SPLIT_PERCENT = 75;

export function useInspectorSplitResize() {
  const [layersPanePercent, setLayersPanePercent] = useState(() => {
    const stored = readStudioUiPreferences().inspectorSplitPercent ?? 40;
    return Math.min(MAX_INSPECTOR_SPLIT_PERCENT, Math.max(MIN_INSPECTOR_SPLIT_PERCENT, stored));
  });
  const splitContainerRef = useRef<HTMLDivElement>(null);
  const splitDragRef = useRef<{
    startY: number;
    startPercent: number;
    height: number;
  } | null>(null);

  const handleInspectorSplitResizeStart = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      const height = splitContainerRef.current?.getBoundingClientRect().height ?? 0;
      splitDragRef.current = {
        startY: event.clientY,
        startPercent: layersPanePercent,
        height,
      };
    },
    [layersPanePercent],
  );

  const handleInspectorSplitResizeMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = splitDragRef.current;
    if (!drag || drag.height <= 0) return;
    const deltaPercent = ((event.clientY - drag.startY) / drag.height) * 100;
    const next = Math.min(
      MAX_INSPECTOR_SPLIT_PERCENT,
      Math.max(MIN_INSPECTOR_SPLIT_PERCENT, drag.startPercent + deltaPercent),
    );
    setLayersPanePercent(next);
    writeStudioUiPreferences({ inspectorSplitPercent: next });
  }, []);

  const handleInspectorSplitResizeEnd = useCallback(() => {
    splitDragRef.current = null;
  }, []);

  return {
    layersPanePercent,
    splitContainerRef,
    handleInspectorSplitResizeStart,
    handleInspectorSplitResizeMove,
    handleInspectorSplitResizeEnd,
  };
}
