import type { TimelineElement } from "../player";
import { layoutAfterTrackInsert } from "../player/components/timelineDragLanding";
import { canMoveTimelineElement } from "../player/components/timelineAuthoredMoveTarget";
import type { TimelineDropPlacement } from "../player/components/timelineCallbacks";
import { applyPatchByTarget, readAttributeByTarget } from "./sourcePatcher";
import { buildPatchTarget } from "../hooks/timelineEditingHelpers";
import { formatTimelineAttributeNumber } from "../player/components/timelineEditing";

export interface DropTrackInsertPlan {
  /** Lane the dropped clip is written on. */
  track: number;
  /** Existing clips whose lane changes to make room. */
  renumbers: Array<{ element: TimelineElement; track: number }>;
}

/** Plan a new lane at boundary `insertRow` with the renumber a clip drag into a gutter uses.
 *  Null when a locked clip would have to move. */
export function planDropTrackInsert(input: {
  elements: TimelineElement[];
  /** The row order the timeline shows (anchor rows included), which `insertRow` indexes. */
  trackOrder: readonly number[];
  insertRow: number;
  dropped: Pick<TimelineElement, "id" | "tag" | "start" | "duration">;
}): DropTrackInsertPlan | null {
  const { elements, trackOrder, insertRow, dropped } = input;
  const newElement: TimelineElement = {
    ...dropped,
    key: dropped.id,
    // Parked on an existing lane so it adds no lane of its own to the topology.
    track: elements[0]?.track ?? 0,
    // sameSourceFile compares this raw field: borrow the peers' value, not the resolved path.
    sourceFile: elements[0]?.sourceFile,
  };
  const layout = layoutAfterTrackInsert(newElement, dropped.start, insertRow, null, {
    elements: [...elements, newElement],
    trackOrder: [...trackOrder],
  });
  if (!layout) return null;
  const byKey = new Map(elements.map((e) => [e.key ?? e.id, e]));
  const renumbers: DropTrackInsertPlan["renumbers"] = [];
  for (const norm of layout.normalized) {
    const key = norm.key ?? norm.id;
    if (key === dropped.id) continue;
    const src = byKey.get(key);
    if (!src || norm.track === (src.authoredTrack ?? src.track)) continue;
    if (!canMoveTimelineElement(src)) return null;
    renumbers.push({ element: src, track: norm.track });
  }
  const track = layout.normalized.find((n) => (n.key ?? n.id) === dropped.id)?.track;
  return track == null ? null : { track, renumbers };
}

/** Rewrite `data-track-index` on each renumbered clip's opening tag, via the shared source patcher. */
export function applyTrackRenumbers(source: string, plan: DropTrackInsertPlan): string {
  let out = source;
  for (const { element, track } of plan.renumbers) {
    const target = buildPatchTarget(element);
    if (!target || readAttributeByTarget(out, target, "track-index") === undefined) {
      throw new Error(`Cannot renumber the track of "${element.id}" in the source`);
    }
    out = applyPatchByTarget(out, target, {
      type: "attribute",
      property: "track-index",
      value: formatTimelineAttributeNumber(track),
    });
  }
  return out;
}

/** The lane a dropped clip is written on and the source with any lanes pushed down to make room. */
export function resolveDropTrack(input: {
  source: string;
  elements: TimelineElement[];
  placement: TimelineDropPlacement;
  dropped: Pick<TimelineElement, "id" | "tag" | "start" | "duration">;
}): { source: string; track: number } {
  const { source, elements, placement, dropped } = input;
  if (placement.insertRow == null) return { source, track: placement.track };
  const { insertRow, trackOrder } = placement;
  const plan = planDropTrackInsert({ elements, trackOrder, insertRow, dropped });
  if (!plan) throw new Error("Cannot open a new track here: a locked clip would have to move.");
  return { source: applyTrackRenumbers(source, plan), track: plan.track };
}
