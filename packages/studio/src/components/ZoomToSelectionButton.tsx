import { FrameCorners } from "@phosphor-icons/react";
import { usePlayerStore } from "../player";
import { STUDIO_PLAIN_KEYS } from "../player/components/studioShortcuts";
import {
  selectedClipsRange,
  zoomToSelectedClips,
} from "../player/components/timelineSelectionZoom";
import { Tooltip } from "./ui";
import { flatDisabled, flatIdle } from "./timelineToolbarStyles";

export function ZoomToSelectionButton() {
  const elements = usePlayerStore((s) => s.elements);
  const selectedElementIds = usePlayerStore((s) => s.selectedElementIds);
  const selectedElementId = usePlayerStore((s) => s.selectedElementId);
  const ids = selectedElementId ? [...selectedElementIds, selectedElementId] : selectedElementIds;
  const canZoom = selectedClipsRange(elements, ids) !== null;
  return (
    <Tooltip
      label={
        canZoom
          ? `Zoom to selected clips (${STUDIO_PLAIN_KEYS.zoomToSelection.toUpperCase()})`
          : "Select clips to zoom to them"
      }
    >
      <button
        type="button"
        aria-label="Zoom to selected clips"
        disabled={!canZoom}
        onClick={() => void zoomToSelectedClips()}
        className={canZoom ? flatIdle : flatDisabled}
      >
        <FrameCorners size={16} aria-hidden="true" />
      </button>
    </Tooltip>
  );
}
