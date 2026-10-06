// fallow-ignore-file dead-code
import { usePlayerStore, type ZoomMode } from "../store/playerStore";
import { requestTimelineZoom } from "./timelineZoomInput";

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
  return { zoomMode, manualZoomPercent, setZoomMode, setManualZoomPercent: requestTimelineZoom };
}
