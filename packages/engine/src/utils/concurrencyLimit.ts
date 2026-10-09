/** Runs at most `limit` tasks at once; later tasks wait, in order, for a free slot. */
export function createConcurrencyLimit(limit: number): <T>(task: () => Promise<T>) => Promise<T> {
  let active = 0;
  const waiting: Array<() => void> = [];
  return async (task) => {
    if (active >= limit) await new Promise<void>((resolve) => waiting.push(resolve));
    else active++;
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
