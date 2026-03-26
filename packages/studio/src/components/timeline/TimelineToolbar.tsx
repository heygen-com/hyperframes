import { memo, useCallback } from "react";
import { usePlayerStore } from "../../player/store/playerStore";

const ZOOM_STEP = 1.3;
const MIN_PPS = 20;
const MAX_PPS = 800;

interface TimelineToolbarProps {
  onEdit?: () => void;
}

export const TimelineToolbar = memo(function TimelineToolbar({ onEdit }: TimelineToolbarProps) {
  const zoomMode = usePlayerStore((s) => s.zoomMode);
  const pixelsPerSecond = usePlayerStore((s) => s.pixelsPerSecond);

  const handleZoomFit = useCallback(() => {
    usePlayerStore.getState().setZoomMode("fit");
  }, []);

  const handleZoomIn = useCallback(() => {
    const store = usePlayerStore.getState();
    store.setZoomMode("manual");
    store.setPixelsPerSecond(Math.min(MAX_PPS, (store.pixelsPerSecond || 100) * ZOOM_STEP));
  }, []);

  const handleZoomOut = useCallback(() => {
    const store = usePlayerStore.getState();
    store.setZoomMode("manual");
    store.setPixelsPerSecond(Math.max(MIN_PPS, (store.pixelsPerSecond || 100) / ZOOM_STEP));
  }, []);

  const btn = "flex items-center gap-1 px-2 py-1.5 text-xs rounded transition-colors";
  const active = "text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800";

  return (
    <div className="flex items-center gap-0.5 px-2 py-1 bg-neutral-950">
      {/* Edit action */}
      <div className="flex items-center gap-0.5 flex-shrink-0">
        <button
          type="button"
          className={`${btn} ${active}`}
          onClick={onEdit}
          title="Edit range (E)"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M17 3a2.828 2.828 0 114 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
          </svg>
          <span className="hidden sm:inline">Edit</span>
        </button>
      </div>

      <div className="flex-1" />

      {/* Zoom controls */}
      <div className="flex items-center gap-0.5 flex-shrink-0 bg-neutral-900/50 rounded-lg px-1 py-0.5">
        <button
          type="button"
          onClick={handleZoomFit}
          className={`px-2 py-1 text-[11px] rounded-md transition-colors ${
            zoomMode === "fit"
              ? "bg-neutral-700 text-white"
              : "text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800"
          }`}
          title="Fit to view"
        >
          Fit
        </button>
        <div className="w-px h-4 bg-neutral-800" />
        <button
          type="button"
          onClick={handleZoomOut}
          className="px-1.5 py-1 text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800 rounded transition-colors"
          title="Zoom out"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
            <path d="M8 11h6" />
          </svg>
        </button>
        <span className="text-[10px] font-mono tabular-nums text-neutral-500 min-w-[40px] text-center">
          {zoomMode === "fit" ? "Fit" : `${Math.round((pixelsPerSecond / 100) * 100)}%`}
        </span>
        <button
          type="button"
          onClick={handleZoomIn}
          className="px-1.5 py-1 text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800 rounded transition-colors"
          title="Zoom in"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
            <path d="M11 8v6" />
            <path d="M8 11h6" />
          </svg>
        </button>
      </div>
    </div>
  );
});
