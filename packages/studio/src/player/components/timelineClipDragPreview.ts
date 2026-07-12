import type { TimelineElement } from "../store/playerStore";
import type { TimelineStackingReorderIntent } from "./timelineEditing";
import type { TimelineLayerId } from "./timelineTrackOrder";

interface DragPreviewState {
  element: Pick<TimelineElement, "track">;
  previewLayerId: TimelineLayerId;
  previewLayerIndex: number;
}

export interface TimelineMovePreview {
  start: number;
  track: number;
  previewLayerId?: TimelineLayerId;
  previewLayerIndex?: number;
  stackingReorder?: TimelineStackingReorderIntent | null;
}

export interface TimelineGroupMovePreview {
  active: boolean;
  previewStart: number;
}

export function resolveDragPreviewPlacement(
  drag: DragPreviewState,
  nextMove: TimelineMovePreview,
  groupMove: TimelineGroupMovePreview,
): {
  previewStart: number;
  previewTrack: number;
  previewLayerId: TimelineLayerId;
  previewLayerIndex: number;
  previewStackingReorder: TimelineStackingReorderIntent | null;
} {
  if (groupMove.active) {
    return {
      previewStart: groupMove.previewStart,
      previewTrack: drag.element.track,
      previewLayerId: drag.previewLayerId,
      previewLayerIndex: drag.previewLayerIndex,
      previewStackingReorder: null,
    };
  }

  return {
    previewStart: groupMove.previewStart,
    previewTrack: nextMove.track,
    previewLayerId: nextMove.previewLayerId ?? drag.previewLayerId,
    previewLayerIndex: nextMove.previewLayerIndex ?? drag.previewLayerIndex,
    previewStackingReorder: nextMove.stackingReorder ?? null,
  };
}
