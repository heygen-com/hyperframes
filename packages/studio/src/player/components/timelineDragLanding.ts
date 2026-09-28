import type { TimelineElement } from "../store/playerStore";
import type { DragCommitDeps } from "./timelineClipDragCommit";
import { classifyZone, normalizeToZones } from "./timelineZones";
import { sameSourceFile } from "./timelineAuthoredTrack";

const keyOf = (e: TimelineElement) => e.key ?? e.id;

/** A fractional track for a new lane at boundary `insertRow` (0 = above the top);
 *  normalizeToZones compacts it to an integer lane and shifts the clips below. */
function insertTrackValue(trackOrder: number[], insertRow: number): number {
  if (trackOrder.length === 0) return 0;
  if (insertRow <= 0) return trackOrder[0] - 0.5;
  if (insertRow >= trackOrder.length) return trackOrder[trackOrder.length - 1] + 0.5;
  return (trackOrder[insertRow - 1] + trackOrder[insertRow]) / 2;
}

/** The source-file lane layout after inserting `element` at boundary `insertRow`:
 *  the whole-set renumber both the commit and the drag preview read. */
export function layoutAfterTrackInsert(
  element: TimelineElement,
  previewStart: number,
  insertRow: number,
  multi: {
    keys: ReadonlySet<string>;
    movedStart: (e: TimelineElement) => number;
  } | null,
  deps: Pick<DragCommitDeps, "elements" | "trackOrder">,
): {
  normalized: TimelineElement[];
  targetTrack: number;
  writable: (src: TimelineElement) => boolean;
} | null {
  const { elements, trackOrder } = deps;
  const editKey = keyOf(element);
  const targetTrack = insertTrackValue(trackOrder, insertRow);
  // Foreign display rows and the opposite zone must not affect this topology.
  const writableZone = classifyZone(element);
  const writable = (src: TimelineElement): boolean =>
    sameSourceFile(src, element) && classifyZone(src) === writableZone;
  const topologyOrder = [...new Set(elements.filter(writable).map((e) => e.track))].sort(
    (a, b) => a - b,
  );
  const topologyInsertRow = topologyOrder.filter((track) => track < targetTrack).length;
  const topologyTargetTrack = insertTrackValue(topologyOrder, topologyInsertRow);
  const normalized = normalizeToZones(
    elements.filter(writable).map((e) => {
      if (keyOf(e) === editKey) {
        return { ...e, start: previewStart, track: topologyTargetTrack };
      }
      if (multi?.keys.has(keyOf(e))) return { ...e, start: multi.movedStart(e) };
      return e;
    }),
  );
  return { normalized, targetTrack, writable };
}
