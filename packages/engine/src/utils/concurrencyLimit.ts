/**
 * Runs at most `limit` tasks at once; later tasks wait, in order, for a free slot. A waiter whose
 * `signal` aborts stops waiting and runs at once without a slot, so a cancel never queues behind others.
 */
export function createConcurrencyLimit(
  limit: number,
): <T>(task: () => Promise<T>, signal?: AbortSignal) => Promise<T> {
  let active = 0;
  const waiting: Array<() => void> = [];
  const waitForSlot = (signal?: AbortSignal) =>
    new Promise<boolean>((resolve) => {
      const granted = () => {
        signal?.removeEventListener("abort", aborted);
        resolve(true);
      };
      const aborted = () => {
        waiting.splice(waiting.indexOf(granted), 1);
        resolve(false);
      };
      waiting.push(granted);
      signal?.addEventListener("abort", aborted, { once: true });
    });
  return async (task, signal) => {
    if (signal?.aborted) return task();
    if (active < limit) active++;
    else if (!(await waitForSlot(signal))) return task();
    try {
      return await task();
    } finally {
      // Hand the slot straight to the next waiter so a newcomer cannot take it first.
      const next = waiting.shift();
      if (next) next();
      else active--;
    }
  };
}
