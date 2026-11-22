import type { TimelineElement } from "../store/playerStore";
import type { DragCommitDeps, TimelineMoveEdit } from "./timelineClipDragCommit";
import { canMoveTimelineElement as canMoveElement } from "./timelineAuthoredMoveTarget";
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
  deps: Pick<DragCommitDeps, "elements" | "trackOrder" | "trackInsertLayout">,
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
  let topologyOrder = [...new Set(elements.filter(writable).map((e) => e.track))].sort(
    (a, b) => a - b,
  );
  let topologyInsertRow = topologyOrder.filter((track) => track < targetTrack).length;
  const grouped = deps.trackInsertLayout;
  let ranks: Map<number, number> | undefined;
  if (grouped) {
    const writableTracks = new Set(topologyOrder);
    topologyOrder = grouped.trackOrder.filter((track) => writableTracks.has(track));
    topologyInsertRow = grouped.trackOrder
      .slice(0, grouped.topologyRows[insertRow])
      .filter((track) => writableTracks.has(track)).length;
    ranks = new Map(topologyOrder.map((track, index) => [track, index]));
  }
  const topologyTargetTrack = ranks
    ? topologyInsertRow - 0.5
    : insertTrackValue(topologyOrder, topologyInsertRow);
  const normalized = normalizeToZones(
    elements.filter(writable).map((e) => {
      if (keyOf(e) === editKey) {
        return { ...e, start: previewStart, track: topologyTargetTrack };
      }
      const track = ranks ? ranks.get(e.track) : e.track;
      if (track === undefined) throw new Error("Writable track missing from insertion topology");
      const start = multi?.keys.has(keyOf(e)) ? multi.movedStart(e) : e.start;
      return track === e.track && start === e.start ? e : { ...e, start, track };
    }),
  );
  return { normalized, targetTrack, writable };
}

/** Build the one sanctioned multi-clip write: atomically insert and compact a
 * source-file zone, then let the caller sync the deliberate vertical stacking. */
// fallow-ignore-next-line complexity
export function buildTrackInsertEdits(
  element: TimelineElement,
  previewStart: number,
  insertRow: number,
  multi: {
    keys: ReadonlySet<string>;
    movedStart: (e: TimelineElement) => number;
  } | null,
  deps: DragCommitDeps,
): { candidate: TimelineElement[]; edits: TimelineMoveEdit[] } | null {
  const { elements } = deps;
  const editKey = keyOf(element);
  const layout = layoutAfterTrackInsert(element, previewStart, insertRow, multi, deps);
  if (!layout) return null;
  const { normalized, targetTrack, writable } = layout;
  const bySrc = new Map(elements.map((e) => [keyOf(e), e]));
  // A partial zone renumber creates collisions; refuse a shifted locked row.
  for (const norm of normalized) {
    const src = bySrc.get(keyOf(norm));
    if (
      src &&
      writable(src) &&
      !canMoveElement(src) &&
      norm.track !== (src.authoredTrack ?? src.track)
    ) {
      console.warn(
        `[Timeline] Track insert refused: locked clip ${keyOf(src)} would need renumbering`,
      );
      return null;
    }
  }
  const candidate = elements.map((e) => {
    if (keyOf(e) === editKey) return { ...e, start: previewStart, track: targetTrack };
    if (multi?.keys.has(keyOf(e))) return { ...e, start: multi.movedStart(e) };
    return e;
  });
  const edits: TimelineMoveEdit[] = [];
  if (multi) {
    for (const src of elements) {
      const srcKey = keyOf(src);
      if (srcKey !== editKey && multi.keys.has(srcKey) && !writable(src) && canMoveElement(src)) {
        edits.push({
          element: src,
          updates: { start: multi.movedStart(src), track: src.track },
          persistTrack: src.authoredTrack,
        });
      }
    }
  }
  for (const norm of normalized) {
    const src = bySrc.get(keyOf(norm));
    if (!src || !canMoveElement(src)) continue;
    const normKey = keyOf(norm);
    let start = src.start;
    if (normKey === editKey) start = previewStart;
    else if (multi?.keys.has(normKey)) start = multi.movedStart(src);
    edits.push({
      element: src,
      updates: {
        start,
        track: norm.track,
        ...(normKey === editKey && src.audioGroup ? { audioGroup: null } : {}),
      },
    });
  }
  return { candidate, edits };
}
