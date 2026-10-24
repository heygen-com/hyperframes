import type { TimelineElement } from "../store/playerStore";
import { clipWidthPx } from "./TimelineClip";

export function withoutHiddenSlivers(
  elements: readonly TimelineElement[],
  pps: number,
  keep: (element: TimelineElement) => boolean,
): readonly TimelineElement[] {
  if (elements.length < 2) return elements;
  const byStart = [...elements].sort((a, b) => a.start - b.start);
  const hidden = new Set<TimelineElement>();
  let edge = -Infinity;
  for (let i = 0; i < byStart.length; i++) {
    const el = byStart[i]!;
    const left = el.start * pps;
    const right = left + clipWidthPx(el, pps);
    const next = byStart[i + 1];
    const endsRun = !next || next.start * pps >= right;
    const sliver = el.duration * pps < right - left;
    if (sliver && left < edge && !endsRun && !keep(el)) {
      hidden.add(el);
      continue;
    }
    edge = Math.max(edge, right);
  }
  return hidden.size === 0 ? elements : elements.filter((el) => !hidden.has(el));
}
