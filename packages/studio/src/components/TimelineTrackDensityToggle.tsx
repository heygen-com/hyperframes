import { Rows } from "@phosphor-icons/react";
import { useTimelineTrackDensity } from "../player/components/useTimelineTrackHeight";
import { Tooltip } from "./ui";
import { flatActive, flatIdle } from "./timelineToolbarStyles";

/** Toolbar control that switches timeline tracks between comfortable and compact height. */
export function TimelineTrackDensityToggle() {
  const trackDensity = useTimelineTrackDensity((s) => s.density);
  const setTrackDensity = useTimelineTrackDensity((s) => s.setDensity);
  const compactTracks = trackDensity === "compact";
  return (
    <Tooltip label="Compact track height">
      <button
        type="button"
        aria-label="Compact track height"
        aria-pressed={compactTracks}
        onClick={() => setTrackDensity(compactTracks ? "comfortable" : "compact")}
        className={compactTracks ? flatActive : flatIdle}
      >
        <Rows size={16} aria-hidden="true" />
      </button>
    </Tooltip>
  );
}
