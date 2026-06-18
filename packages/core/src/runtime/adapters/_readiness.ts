import type { RuntimeDeterministicAdapter } from "../types";

export function createReadinessAdapter<T extends object>(opts: {
  name: string;
  getInstances: () => T[];
  waitFor: (instance: T) => PromiseLike<void>;
}): RuntimeDeterministicAdapter {
  let pendingPromise: PromiseLike<void> | null = null;
  const settled = new WeakSet<T>();

  return {
    name: opts.name,
    discover: () => {},
    seek: () => {},
    pause: () => {},
    play: () => {},
    revert: () => {},
    getReadyPromise: () => {
      const instances = opts.getInstances();
      if (instances.length === 0) return null;
      const unsettled = instances.filter((i) => !settled.has(i));
      if (unsettled.length === 0) return null;
      if (pendingPromise) return pendingPromise;
      pendingPromise = Promise.allSettled(
        unsettled.map((i) =>
          opts.waitFor(i).then(() => {
            settled.add(i);
          }),
        ),
      ).then(() => {
        pendingPromise = null;
      });
      return pendingPromise;
    },
  };
}
