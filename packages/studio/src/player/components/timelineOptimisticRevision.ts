import type { TimelineElement } from "../store/playerStore";

type UpdateElement = (key: string, updates: Partial<TimelineElement>) => void;
// Timing-only gestures must not take ownership of an earlier membership write.
type RevisionScope = "timing" | "membership";
const revisionsByUpdater = new WeakMap<UpdateElement, Map<RevisionScope, Map<string, number>>>();

export function beginTimelineOptimisticGesture(
  updateElement: UpdateElement,
  keys: readonly string[],
  scope: RevisionScope = "timing",
): Map<string, number> {
  let scopes = revisionsByUpdater.get(updateElement);
  if (!scopes) {
    scopes = new Map();
    revisionsByUpdater.set(updateElement, scopes);
  }
  let revisions = scopes.get(scope);
  if (!revisions) {
    revisions = new Map();
    scopes.set(scope, revisions);
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
  scope: RevisionScope = "timing",
): boolean {
  return (
    gesture.has(key) &&
    revisionsByUpdater.get(updateElement)?.get(scope)?.get(key) === gesture.get(key)
  );
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
