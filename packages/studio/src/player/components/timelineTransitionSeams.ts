import type { TimelineElement } from "../store/playerStore";

export interface TimelineTransitionSeam {
  outgoing: TimelineElement;
  incoming: TimelineElement;
  centerTime: number;
  duration: number;
}

export function deriveTimelineTransitionSeams(
  elements: readonly TimelineElement[],
): TimelineTransitionSeam[] {
  const sorted = [...elements].sort((left, right) => left.start - right.start);
  const seams: TimelineTransitionSeam[] = [];
  for (let index = 0; index < sorted.length - 1; index += 1) {
    const outgoing = sorted[index]!;
    const incoming = sorted[index + 1]!;
    const outgoingEnd = outgoing.start + outgoing.duration;
    const overlapStart = Math.max(outgoing.start, incoming.start);
    const overlapEnd = Math.min(outgoingEnd, incoming.start + incoming.duration);
    const duration = overlapEnd - overlapStart;
    if (duration <= 0) continue;
    seams.push({
      outgoing,
      incoming,
      centerTime: overlapStart + duration / 2,
      duration,
    });
  }
  return seams;
}
