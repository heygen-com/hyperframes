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

/**
 * Runtime clip kind for a timeline element, mirroring the runtime's own
 * classification (normalizeTrackAssignments in @hyperframes/core).
 */
export function runtimeKindForElement(el: { tag: string; compositionSrc?: string }): string {
  if (el.compositionSrc) return "composition";
  const tag = el.tag.toLowerCase();
  if (tag === "video") return "video";
  if (tag === "audio") return "audio";
  if (tag === "img") return "image";
  return "element";
}

/** Map a drop-preview kind to the runtime clip kind used for track normalization. */
const RUNTIME_KIND: Record<TimelineDropPreviewKind, string | null> = {
  image: "image",
  video: "video",
  audio: "audio",
  block: "composition",
  unknown: null,
};

/**
 * The runtime splits any track whose clips mix kinds (normalizeTrackAssignments),
 * so dropping e.g. an image onto a row of text elements would silently land on a
 * different row after reload. Resolve that up front: when the target row's kinds
 * don't include the dragged kind, retarget to a fresh track below everything so
 * the ghost shows where the clip will actually live.
 */
function resolveKindAwareTrack(input: {
  track: number;
  kind: TimelineDropPreviewKind;
  trackOrder: readonly number[];
  trackKinds: ReadonlyMap<number, ReadonlySet<string>> | null;
}): { track: number; isNewTrack: boolean } {
  const isNewTrack = !input.trackOrder.includes(input.track);
  const runtimeKind = RUNTIME_KIND[input.kind];
  if (isNewTrack || !runtimeKind || !input.trackKinds) return { track: input.track, isNewTrack };
  const kinds = input.trackKinds.get(input.track);
  if (!kinds || kinds.size === 0 || kinds.has(runtimeKind)) {
    return { track: input.track, isNewTrack };
  }
  const maxTrack = input.trackOrder.length > 0 ? Math.max(...input.trackOrder) : -1;
  return { track: maxTrack + 1, isNewTrack: true };
}

export function resolveTimelineDropPreview(input: {
  drop: Parameters<typeof resolveTimelineAssetDrop>[0];
  clientX: number;
  clientY: number;
  session: DragSessionPayload | null;
  fileItems: ReadonlyArray<{ kind: string; type: string }>;
  snapTargets: readonly TimelineSnapTarget[];
  snapEnabled: boolean;
  /** Runtime clip kinds present per track, for kind-aware retargeting. */
  trackKinds?: ReadonlyMap<number, ReadonlySet<string>> | null;
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

  const target = resolveKindAwareTrack({
    track: placement.track,
    kind,
    trackOrder: input.drop.trackOrder,
    trackKinds: input.trackKinds ?? null,
  });

  return {
    start,
    track: target.track,
    isNewTrack: target.isNewTrack,
    durationSec,
    kind,
    label,
    extraCount: Math.max(0, files.length - 1),
    snapTime,
    snapType,
  };
}
