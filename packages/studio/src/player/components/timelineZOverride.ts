/**
 * timelineZOverride — detect clips whose PAINT order diverges from LANE order.
 *
 * Track order is the DEFAULT paint order; authored z is the ADVANCED override
 * (see timelineZMirror's model comment). When a user authors z that contradicts
 * lane order, the timeline surfaces it with a "z" badge on the affected clips
 * (TimelineClip) instead of silently showing a lane order the canvas ignores.
 *
 * Rule (deterministic, symmetric): mark clip X when there exists a
 * temporally-overlapping, same-stacking-context, visual neighbor Y such that
 * `laneIsAbove(X, Y) XOR paintsAbove(X, Y)` — the lane relation and the paint
 * relation disagree. Both ends of a strict contradiction get marked (X above in
 * lane but painting below ⇒ Y below in lane but painting above). The predicates
 * are the EXACT ones timelineStackingSync uses (laneIsAbove, paintsAbove with
 * the z/domIndex tie-break, epsilon overlapsInTime) so badge and sync can never
 * disagree about what a contradiction is.
 *
 * zIndex source: the store's `TimelineElement.zIndex`. It is read from the live
 * DOM at element-build time, and — on this branch — handleDomZIndexReorderCommit
 * syncs it synchronously on every z commit via the entry's timeline key, so the
 * store z is fresh immediately after a canvas z-order menu action (no reload
 * needed for the badge to update). Clips with an UNRESOLVED z (undefined /
 * non-finite) are excluded outright, mirroring the sync's NaN exclusion — an
 * unknown z must not fabricate a phantom contradiction.
 *
 * Cost: O(n · overlaps) pairwise scan within each stacking context — fine at
 * timeline sizes (dozens to low hundreds of clips, see TimelineLanes'
 * no-virtualization note).
 */

import type { TimelineElement } from "../store/playerStore";
import { classifyZone } from "./timelineZones";
import { laneIsAbove, overlapsInTime, paintsAbove } from "./timelineStackingSync";

interface OverrideCandidate {
  key: string;
  start: number;
  duration: number;
  track: number;
  zIndex: number;
  domIndex: number;
  contextKey: string | null;
}

/** Visual clips with a resolved z, projected for the pairwise scan. Audio has
 *  no visual stacking; an unresolved z (undefined / NaN) is excluded outright.
 *  `domIndex` is the discovery-order array index (= DOM document position). */
function toOverrideCandidates(elements: TimelineElement[]): OverrideCandidate[] {
  const candidates: OverrideCandidate[] = [];
  for (let domIndex = 0; domIndex < elements.length; domIndex += 1) {
    const el = elements[domIndex];
    const comparable =
      classifyZone(el) !== "audio" && el.duration > 0 && Number.isFinite(el.zIndex ?? Number.NaN);
    if (!comparable) continue;
    candidates.push({
      key: el.key ?? el.id,
      start: el.start,
      duration: el.duration,
      track: el.track,
      zIndex: el.zIndex!,
      domIndex,
      // Same normalization as timelineStackingSync's contextKey: null and
      // undefined both mean the root stacking context.
      contextKey: el.stackingContextId ?? null,
    });
  }
  return candidates;
}

/** The pair is comparable at all: leaf z is meaningless across stacking
 *  contexts, and only temporal overlap creates a paint relation. */
function pairComparable(x: OverrideCandidate, y: OverrideCandidate): boolean {
  return x.contextKey === y.contextKey && overlapsInTime(x, y);
}

/**
 * Keys of clips whose paint order contradicts their lane order.
 *
 * @param elements  The expanded DISPLAY element set in discovery order — its
 *                  array index is the DOM document position (the same
 *                  assumption syncStackingForEdit documents), which feeds the
 *                  equal-z DOM-order tie-break.
 */
export function computeZOverrideKeys(elements: TimelineElement[]): Set<string> {
  const candidates = toOverrideCandidates(elements);
  const marked = new Set<string>();
  for (let i = 0; i < candidates.length; i += 1) {
    for (let j = i + 1; j < candidates.length; j += 1) {
      const x = candidates[i];
      const y = candidates[j];
      if (!pairComparable(x, y)) continue;
      if (laneIsAbove(x, y) !== paintsAbove(x, y)) marked.add(x.key);
      if (laneIsAbove(y, x) !== paintsAbove(y, x)) marked.add(y.key);
    }
  }
  return marked;
}
