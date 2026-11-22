// The local time each scene timeline was last drawn at: a seek that would draw it there again skips it.
const restingAt = new WeakMap<object, number>();

export function restSceneAt(timeline: object, time: number): void {
  restingAt.set(timeline, time);
}

export const sceneRestingAt = (timeline: object): number | undefined => restingAt.get(timeline);

export function forgetSceneRestsReturningRested(timelines: readonly object[]): object[] {
  return timelines.filter((timeline) => restingAt.delete(timeline));
}
