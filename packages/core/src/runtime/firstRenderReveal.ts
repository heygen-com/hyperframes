import { isElementNode } from "./domRealm";
import { CLIP_HIDDEN_ATTR } from "./timedClipHide";
import type { RuntimeTimelineChildLike } from "./types";

type Child = RuntimeTimelineChildLike & {
  timeScale?: () => number;
  repeat?: () => number;
  totalDuration?: () => number;
  getChildren?: (
    nested?: boolean,
    tweens?: boolean,
    timelines?: boolean,
    ignoreBeforeTime?: number,
  ) => Child[];
};

const plain = (child: Child) => (child.timeScale?.() ?? 1) === 1 && (child.repeat?.() ?? 0) === 0;
const startOf = (child: Child, offset: number) => offset + (child.startTime?.() ?? 0);
const endOf = (child: Child, start: number) => start + (child.totalDuration?.() ?? Infinity);
const targetsOf = (child: Child) => child.targets?.() ?? [];

function addHiddenClipsHolding(target: unknown, clips: Set<Element>): void {
  for (let el = isElementNode(target) ? target : null; el; el = el.parentElement)
    if (el.hasAttribute(CLIP_HIDDEN_ATTR)) clips.add(el);
}

/**
 * The hidden clips holding a target of a tween that starts in (from, to], so renders for the first time on a seek
 * there. Null when a nested timeline is scaled or repeats, as its children's times are then not plain offsets.
 */
export function clipsFirstRenderedIn(
  timeline: RuntimeTimelineChildLike,
  from: number,
  to: number,
): Set<Element> | null {
  const clips = new Set<Element>();
  const overlaps = (start: number, end: number) => end > from && start <= to;
  const timelinesIn = (parent: Child) => parent.getChildren?.(false, false, true) ?? [];
  // ignoreBeforeTime leaves out tweens that started before the span, which were drawn already.
  const tweensIn = (parent: Child, offset: number) =>
    parent.getChildren?.(false, true, false, from - offset) ?? [];
  const addTargets = (tween: Child, offset: number) => {
    const start = startOf(tween, offset);
    if (start > from && start <= to)
      for (const target of targetsOf(tween)) addHiddenClipsHolding(target, clips);
  };
  // Timelines wholly before the span were drawn already and ones after it are not reached, so neither is opened.
  const visit = (parent: Child, offset: number): boolean => {
    const nestedPlain = timelinesIn(parent).every((nested) => {
      const start = startOf(nested, offset);
      return plain(nested) && (!overlaps(start, endOf(nested, start)) || visit(nested, start));
    });
    if (nestedPlain) for (const tween of tweensIn(parent, offset)) addTargets(tween, offset);
    return nestedPlain;
  };
  return visit(timeline as Child, 0) ? clips : null;
}
