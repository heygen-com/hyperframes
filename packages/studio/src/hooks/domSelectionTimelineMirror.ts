import type { SelectElementOptions, TimelineElement } from "../player";
import { findMatchingTimelineElementId, findTimelineIdByAncestor } from "../utils/studioHelpers";
import type { DomEditSelection } from "../components/editor/domEditing";
import { logSelect } from "../utils/selectDebug";

interface TimelineMirrorDeps {
  timelineElements: TimelineElement[];
  setSelectedTimelineElementId: (id: string | null, options?: SelectElementOptions) => void;
  setTimelineSelectionSet: (ids: Set<string>) => void;
}

/**
 * Mirror a canvas selection onto the timeline: the whole set first, then the
 * primary as its anchor.
 *
 * The timeline is the source of truth for what is selected and it syncs back —
 * whatever it holds replaces the canvas selection a moment later. Announcing only
 * the primary therefore drops every other member. Worse, anchoring with
 * `preserveSet` on an id the set does not yet contain empties the set outright,
 * and an empty set syncs back as "nothing is selected" — which is how adding a
 * second element, or moving a group, could wipe the selection instead of keeping
 * it. Publishing the members first is what makes the anchor a member, so
 * preserving the set is meaningful rather than destructive.
 */
export function announceTimelineSelection(
  deps: TimelineMirrorDeps,
  group: DomEditSelection[],
  primary: DomEditSelection | null,
): void {
  const { timelineElements, setSelectedTimelineElementId, setTimelineSelectionSet } = deps;
  if (!primary) {
    setTimelineSelectionSet(new Set());
    setSelectedTimelineElementId(null);
    return;
  }
  const timelineIdFor = (selection: DomEditSelection) =>
    findMatchingTimelineElementId(selection, timelineElements) ??
    findTimelineIdByAncestor(
      selection.element,
      timelineElements,
      selection.sourceFile || "index.html",
    );
  const members = group.map(timelineIdFor).filter((id): id is string => Boolean(id));
  const anchor = timelineIdFor(primary);
  // A member with no timeline row of its own resolves to null and is dropped here,
  // so a group can announce fewer ids than it has — or none, which reads back as an
  // empty selection and takes the canvas selection with it.
  logSelect("announce", {
    group: group.length,
    published: members.length,
    anchor,
    anchorPublished: anchor != null && members.includes(anchor),
  });
  // Only a real multi-selection publishes members. A single selection keeps the
  // older contract on purpose: anchoring with preserveSet holds a live set the
  // element already belongs to (a late async primary must not collapse a group)
  // and collapses otherwise, which is what a fresh click means.
  if (group.length > 1) setTimelineSelectionSet(new Set(members));
  setSelectedTimelineElementId(anchor, { preserveSet: true });
}
