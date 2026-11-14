export class JobSlotsFullError extends Error {
  constructor() {
    super("job queue full");
    this.name = "JobSlotsFullError";
  }
}

/** Runs at most `limit` jobs at once with `maxWaiting` more queued; a waiter whose signal aborts leaves the queue. */
export function createJobSlots(limit: number, maxWaiting: number) {
  let running = 0;
  const waiting: Array<() => void> = [];

  const acquire = (signal?: AbortSignal) =>
    new Promise<void>((resolve, reject) => {
      if (signal?.aborted) return reject(signal.reason);
      if (running < limit) {
        running++;
        return resolve();
      }
      if (waiting.length >= maxWaiting) return reject(new JobSlotsFullError());
      const leave = () => {
        waiting.splice(waiting.indexOf(start), 1);
        reject(signal?.reason);
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
