import type { TimelineElement } from "../store/playerStore";
import type { DragCommitDeps, TimelineMoveEdit } from "./timelineClipDragCommit";
import type { DraggedClipState } from "./timelineClipDragTypes";
import { isLinkedSelectionOn } from "../../utils/linkedClipPreferences";
import { sharesLinkGroup } from "./audioClipLink";
import { landsOnLaneClip, timeRangesOverlap } from "./timelineCollision";
import { getTimelineEditCapabilities } from "./timelineEditing";
import { round3, TRACK_GAP_EPSILON_S } from "./timelineGaps";
import { isMainTrackElement } from "./timelineZones";

const keyOf = (e: TimelineElement) => e.key ?? e.id;

// A main-track clip dropped over others goes before the first one whose middle is past its left
// edge; that one and the rest move right by its length, and its old gap closes. Null: no overlap
// or a locked clip would move; empty: nothing moves.
export function resolveMainTrackInsert(
  elements: readonly TimelineElement[],
  dragged: TimelineElement,
  aimStart: number,
  linked: boolean,
): Array<{ element: TimelineElement; start: number }> | null {
  if (!isMainTrackElement(dragged)) return null;
  const others = elements
    .filter((e) => keyOf(e) !== keyOf(dragged) && isMainTrackElement(e))
    .sort((a, b) => a.start - b.start);
  const aimEnd = aimStart + dragged.duration;
  const hit = others.some((e) =>
    timeRangesOverlap(aimStart, aimEnd, e.start, e.start + e.duration),
  );
  const last = others.at(-1);
  if (!hit || !last) return null;
  const at = others.findIndex((e) => e.start + e.duration / 2 > aimStart);
  const firstPushed = at < 0 ? others.length : at;
  const boundary = others[at]?.start ?? last.start + last.duration;
  const lift = (time: number) => (time > dragged.start ? dragged.duration : 0);
  const main = [
    { element: dragged, start: round3(boundary - lift(boundary)) },
    ...others.map((e, i) => ({
      element: e,
      start: round3(e.start - lift(e.start) + (i >= firstPushed ? dragged.duration : 0)),
    })),
  ].filter((m) => Math.abs(m.start - m.element.start) > TRACK_GAP_EPSILON_S);
  const partners = elements.flatMap((partner) => {
    if (!linked || isMainTrackElement(partner)) return [];
    const lead = main.find((m) => sharesLinkGroup(m.element, partner));
    if (!lead) return [];
    return [{ element: partner, start: round3(partner.start + lead.start - lead.element.start) }];
  });
  const moves = [...main, ...partners];
  // A partner may not land on a clip in its lane, moved or not, nor start before 0; main-track moves only reorder.
  if (landsOnLaneClip(elements, moves, partners) || partners.some((p) => p.start < 0)) return null;
  return moves.every((m) => getTimelineEditCapabilities(m.element).canMove) ? moves : null;
}

/** The insert's moves for a finished drag, or null when the drop is not an insert. */
export function resolveMainTrackInsertEdits(
  drag: DraggedClipState,
  deps: DragCommitDeps,
  movingKeys: ReadonlySet<string> | undefined,
): TimelineMoveEdit[] | null {
  if (drag.aimStart == null || (drag.desiredTrack ?? drag.previewTrack) !== drag.element.track) {
    return null;
  }
  // A group drag inserts only when the group is the clip and its linked partners.
  const groupOfOne = deps.elements.every(
    (e) =>
      !movingKeys?.has(keyOf(e)) ||
      keyOf(e) === keyOf(drag.element) ||
      sharesLinkGroup(e, drag.element),
  );
  if (!groupOfOne) return null;
  const linked = isLinkedSelectionOn();
  const moves = resolveMainTrackInsert(deps.elements, drag.element, drag.aimStart, linked);
  if (!moves) return null;
  return moves.map(({ element, start }) => ({ element, updates: { start, track: element.track } }));
}
