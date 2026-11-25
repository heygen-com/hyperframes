// The local time each scene timeline was last drawn at: a seek that would draw it there again skips it.
const restingAt = new WeakMap<object, number>();
const redrawDue = new WeakSet<object>();

export function restSceneAt(timeline: object, time: number): void {
  restingAt.set(timeline, time);
}

export const sceneRestingAt = (timeline: object): number | undefined => restingAt.get(timeline);

export function takeSceneRedrawDue(timeline: object): boolean {
  return redrawDue.delete(timeline);
}

export function markRestingScenesForRedraw(timelines: readonly object[]): void {
  for (const timeline of timelines) if (restingAt.has(timeline)) redrawDue.add(timeline);
}
