import type { DragSessionPayload } from "../../utils/dragSession";
import { resolveTimelineAssetDrop } from "./timelineLayout";
import {
  TIMELINE_SNAP_PX,
  snapTimelineTime,
  type TimelineSnapTarget,
  type TimelineSnapType,
} from "./timelineSnapping";

export type TimelineDropPreviewKind = "image" | "video" | "audio" | "block" | "unknown";

export interface TimelineDropPreview {
  start: number;
  track: number;
  isNewTrack: boolean;
  durationSec: number;
  kind: TimelineDropPreviewKind;
  label: string;
  /** Additional files beyond the first, for OS multi-file drags ("+N more"). */
  extraCount: number;
  snapTime: number | null;
  snapType: TimelineSnapType | null;
}

export const DEFAULT_DROP_PREVIEW_DURATION: Record<TimelineDropPreviewKind, number> = {
  image: 3,
  video: 5,
  audio: 5,
  block: 5,
  unknown: 5,
};

function kindFromMime(mime: string): TimelineDropPreviewKind {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  return "unknown";
}

export function resolveTimelineDropPreview(input: {
  drop: Parameters<typeof resolveTimelineAssetDrop>[0];
  clientX: number;
  clientY: number;
  session: DragSessionPayload | null;
  fileItems: ReadonlyArray<{ kind: string; type: string }>;
  snapTargets: readonly TimelineSnapTarget[];
  snapEnabled: boolean;
}): TimelineDropPreview {
  const placement = resolveTimelineAssetDrop(input.drop, input.clientX, input.clientY);
  const files = input.fileItems.filter((item) => item.kind === "file");

  let kind: TimelineDropPreviewKind;
  let durationSec: number;
  let label: string;
  if (input.session) {
    kind = input.session.kind;
    durationSec = input.session.durationSec ?? DEFAULT_DROP_PREVIEW_DURATION[kind];
    label = input.session.label;
  } else if (files.length > 0) {
    kind = kindFromMime(files[0].type);
    durationSec = DEFAULT_DROP_PREVIEW_DURATION[kind];
    label = files.length > 1 ? `${files.length} files` : "File";
  } else {
    kind = "unknown";
    durationSec = DEFAULT_DROP_PREVIEW_DURATION.unknown;
    label = "Drop";
  }

  let start = placement.start;
  let snapTime: number | null = null;
  let snapType: TimelineSnapType | null = null;
  if (input.snapEnabled && input.snapTargets.length > 0) {
    const thresholdSecs = TIMELINE_SNAP_PX / Math.max(input.drop.pixelsPerSecond, 1);
    const snapped = snapTimelineTime(start, input.snapTargets, thresholdSecs);
    if (snapped.target) {
      start = Math.max(0, snapped.time);
      snapTime = snapped.target.time;
      snapType = snapped.target.type;
    }
  }

  return {
    start,
    track: placement.track,
    isNewTrack: !input.drop.trackOrder.includes(placement.track),
    durationSec,
    kind,
    label,
    extraCount: Math.max(0, files.length - 1),
    snapTime,
    snapType,
  };
}
