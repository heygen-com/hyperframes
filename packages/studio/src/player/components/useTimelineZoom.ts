// fallow-ignore-file dead-code
import { usePlayerStore, type ZoomMode } from "../store/playerStore";
import { cancelTimelineZoom, requestTimelineZoom } from "./timelineZoomInput";

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
  const setStoreZoomMode = usePlayerStore((s) => s.setZoomMode);
  // A mode picked now (Fit) wins over a zoom still easing or waiting to be laid out.
  const setZoomMode = (mode: ZoomMode) => {
    cancelTimelineZoom();
    setStoreZoomMode(mode);
  };
  return { zoomMode, manualZoomPercent, setZoomMode, setManualZoomPercent: requestTimelineZoom };
}
