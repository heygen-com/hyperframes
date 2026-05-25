import {
  getNextTimelineZoomPercent,
  getTimelineZoomPercent,
} from "../player/components/timelineZoom";
import { getTimelineToggleTitle } from "../utils/timelineDiscovery";
import { usePlayerStore } from "../player";
import { Tooltip } from "./ui";

interface TimelineToolbarProps {
  toggleTimelineVisibility: () => void;
}

export function TimelineToolbar({ toggleTimelineVisibility }: TimelineToolbarProps) {
  const zoomMode = usePlayerStore((s) => s.zoomMode);
  const manualZoomPercent = usePlayerStore((s) => s.manualZoomPercent);
  const setZoomMode = usePlayerStore((s) => s.setZoomMode);
  const setManualZoomPercent = usePlayerStore((s) => s.setManualZoomPercent);
  const displayedTimelineZoomPercent = getTimelineZoomPercent(zoomMode, manualZoomPercent);

  return (
    <div className="border-b border-neutral-800/40 bg-neutral-950/96">
      <div className="flex items-center justify-between px-3 py-2">
        <div className="text-[10px] font-medium uppercase tracking-[0.16em] text-neutral-500">
          Timeline
        </div>
        <div className="flex items-center gap-1">
          <Tooltip label="Fit timeline to width">
            <button
              type="button"
              onClick={() => setZoomMode("fit")}
              className={`h-7 px-2.5 rounded-md border text-[11px] font-medium transition-colors ${
                zoomMode === "fit"
                  ? "border-studio-accent/30 bg-studio-accent/10 text-studio-accent"
                  : "border-neutral-800 text-neutral-400 hover:border-neutral-700 hover:text-neutral-200"
              }`}
            >
              Fit
            </button>
          </Tooltip>
          <Tooltip label="Zoom out">
            <button
              type="button"
              onClick={() => {
                setZoomMode("manual");
                setManualZoomPercent(
                  getNextTimelineZoomPercent("out", zoomMode, manualZoomPercent),
                );
              }}
              className="h-7 w-7 rounded-md border border-neutral-800 text-neutral-400 transition-colors hover:border-neutral-700 hover:text-neutral-200"
            >
              -
            </button>
          </Tooltip>
          <div className="min-w-[58px] text-center text-[10px] font-medium tabular-nums text-neutral-500">
            {`${displayedTimelineZoomPercent}%`}
          </div>
          <Tooltip label="Zoom in">
            <button
              type="button"
              onClick={() => {
                setZoomMode("manual");
                setManualZoomPercent(getNextTimelineZoomPercent("in", zoomMode, manualZoomPercent));
              }}
              className="h-7 w-7 rounded-md border border-neutral-800 text-neutral-400 transition-colors hover:border-neutral-700 hover:text-neutral-200"
            >
              +
            </button>
          </Tooltip>
          <Tooltip label={getTimelineToggleTitle(true)}>
            <button
              type="button"
              onClick={toggleTimelineVisibility}
              className="ml-1 flex h-7 w-7 items-center justify-center rounded-md text-neutral-500 transition-colors hover:bg-neutral-900 hover:text-neutral-200"
              aria-label="Hide timeline editor"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M5 7h14" />
                <path d="m8 11 4 4 4-4" />
              </svg>
            </button>
          </Tooltip>
        </div>
      </div>
    </div>
  );
}
