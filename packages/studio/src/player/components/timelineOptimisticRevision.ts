import type { TimelineElement } from "../store/playerStore";

type UpdateElement = (key: string, updates: Partial<TimelineElement>) => void;
const revisionsByUpdater = new WeakMap<UpdateElement, Map<string, number>>();

export function beginTimelineOptimisticGesture(
  updateElement: UpdateElement,
  keys: readonly string[],
): Map<string, number> {
  let revisions = revisionsByUpdater.get(updateElement);
  if (!revisions) {
    revisions = new Map();
    revisionsByUpdater.set(updateElement, revisions);
  }
  const gesture = new Map<string, number>();
  for (const key of keys) {
    const revision = (revisions.get(key) ?? 0) + 1;
    revisions.set(key, revision);
    gesture.set(key, revision);
  }
  return gesture;
}

export function isLatestTimelineOptimisticGesture(
  updateElement: UpdateElement,
  gesture: ReadonlyMap<string, number>,
  key: string,
): boolean {
  return revisionsByUpdater.get(updateElement)?.get(key) === gesture.get(key);
}

export function rollbackLatestTimelineOptimisticGesture(
  updateElement: UpdateElement,
  gesture: ReadonlyMap<string, number>,
  rollbacks: ReadonlyArray<{ key: string; updates: Partial<TimelineElement> }>,
): void {
  for (const rollback of rollbacks) {
    if (isLatestTimelineOptimisticGesture(updateElement, gesture, rollback.key)) {
      updateElement(rollback.key, rollback.updates);
    }
  }
}
