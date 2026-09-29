// fallow-ignore-file dead-code
import { useCallback } from "react";
import { usePlayerStore, type ZoomMode } from "../store/playerStore";

export interface TimelineZoomState {
  zoomMode: ZoomMode;
  manualZoomPercent: number;
  setZoomMode: (mode: ZoomMode) => void;
  setManualZoomPercent: (percent: number) => void;
}

/** Shared zoom-related store selectors used by Timeline and TimelineToolbar. */
export function useTimelineZoom(): TimelineZoomState {
  const zoomMode = usePlayerStore((s) => s.zoomMode);
  const manualZoomPercent = usePlayerStore((s) => s.manualZoomPercent);
  const setZoomMode = usePlayerStore((s) => s.setZoomMode);
  const setStorePercent = usePlayerStore((s) => s.setManualZoomPercent);
  // Counted so the timeline tells a person's zoom from a pin or re-pin, which write the percent directly.
  const setManualZoomPercent = useCallback(
    (percent: number) => {
      usePlayerStore.setState((s) => ({ userZoomCount: s.userZoomCount + 1 }));
      setStorePercent(percent);
    },
    [setStorePercent],
  );
  return { zoomMode, manualZoomPercent, setZoomMode, setManualZoomPercent };
}
