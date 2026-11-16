export class JobAbandonedError extends Error {
  constructor() {
    super("job abandoned before it started");
    this.name = "JobAbandonedError";
  }
}

/** Runs at most `limit` jobs at once; a waiter whose signal aborts leaves the queue without starting. */
export function createJobSlots(limit: number) {
  let running = 0;
  const waiting: Array<() => void> = [];

  const acquire = (signal?: AbortSignal) =>
    new Promise<void>((resolve, reject) => {
      if (signal?.aborted) return reject(new JobAbandonedError());
      if (running < limit) {
        running++;
        return resolve();
      }
      const leave = () => {
        waiting.splice(waiting.indexOf(start), 1);
        reject(new JobAbandonedError());
      };
      const start = () => {
        signal?.removeEventListener("abort", leave);
        resolve();
      };
      waiting.push(start);
      signal?.addEventListener("abort", leave, { once: true });
    });

  const release = () => {
    const next = waiting.shift();
    if (next) next();
    else running--;
  };

  return async function run<T>(job: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    await acquire(signal);
    try {
      return await job();
    } finally {
      release();
    }
  };
}
