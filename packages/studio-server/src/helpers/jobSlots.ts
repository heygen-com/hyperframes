export class JobAbandonedError extends Error {
  constructor() {
    super("job abandoned before it started");
    this.name = "JobAbandonedError";
  }
}

export class JobQueueFullError extends Error {
  constructor() {
    super("job queue is full; retry shortly");
    this.name = "JobQueueFullError";
  }
}

/** Runs at most `limit` jobs at once and queues at most `maxWaiting` more; an aborted waiter leaves without starting. */
export function createJobSlots(limit: number, maxWaiting = Number.POSITIVE_INFINITY) {
  let running = 0;
  const waiting: Array<() => void> = [];

  const acquire = (signal?: AbortSignal) =>
    new Promise<void>((resolve, reject) => {
      if (signal?.aborted) return reject(new JobAbandonedError());
      if (running < limit) {
        running++;
        return resolve();
      }
      if (waiting.length >= maxWaiting) return reject(new JobQueueFullError());
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
