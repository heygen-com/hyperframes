import type { TimelineElement } from "../store/playerStore";
import { getTimelineElementIdentity } from "../lib/timelineElementHelpers";
import { getTimelineEditCapabilities } from "./timelineEditing";
import type { DraggedClipState } from "./timelineClipDragTypes";

/** Whether Studio may write timing to this clip (false for locked/implicit rows). */
export function canMoveTimelineElement(element: TimelineElement): boolean {
  return getTimelineEditCapabilities({
    tag: element.tag,
    kind: element.kind,
    duration: element.duration,
    domId: element.domId,
    selector: element.selector,
    compositionSrc: element.compositionSrc,
    playbackStart: element.playbackStart,
    playbackStartAttr: element.playbackStartAttr,
    sourceDuration: element.sourceDuration,
    timingSource: element.timingSource,
    timelineLocked: element.timelineLocked,
  }).canMove;
}

interface ExpandedHostAliasDeps {
  elements: TimelineElement[];
  selectedKeys?: ReadonlySet<string> | null;
}

/**
 * Expanded children keep their own source-file identity for direct edits, but a
 * selection can briefly contain both a composition host and one of its visible
 * expanded children. That pair is one authored move target, not two. Resolve it
 * to the host before time/lane/collision commit so ordinary clip placement stays
 * the single owner of the gesture semantics.
 */
export function resolveExpandedHostAlias(
  drag: DraggedClipState,
  deps: ExpandedHostAliasDeps,
): { drag: DraggedClipState; selectedKeys: ReadonlySet<string> } | null {
  const hostKey = drag.element.expandedHostKey;
  const childKey = getTimelineElementIdentity(drag.element);
  const selectedKeys = deps.selectedKeys;
  if (!hostKey || !selectedKeys?.has(hostKey) || !selectedKeys.has(childKey)) return null;

  const host = deps.elements.find((element) => getTimelineElementIdentity(element) === hostKey);
  if (!host || !canMoveTimelineElement(host)) return null;

  const delta = drag.previewStart - drag.element.start;
  const mapTrack = (track: number | undefined): number | undefined =>
    track === drag.element.track ? host.track : track;
  const collapsedKeys = new Set(selectedKeys);
  collapsedKeys.delete(childKey);
  collapsedKeys.add(hostKey);

  return {
    drag: {
      ...drag,
      element: host,
      previewStart: Math.max(0, Math.round((host.start + delta) * 1000) / 1000),
      previewTrack: mapTrack(drag.previewTrack) ?? host.track,
      desiredTrack: mapTrack(drag.desiredTrack),
    },
    selectedKeys: collapsedKeys,
  };
}
