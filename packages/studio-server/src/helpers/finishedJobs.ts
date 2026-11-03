// The adapter finishes a job by changing it in place, so a sweep notes when it first sees each job finished.
const finishedSince = new WeakMap<object, number>();

/** Forgets the jobs finished for longer than `ttlMs`, counted from when they finished, never from when they started:
 * a render that ran longer than the TTL stays readable after it ends. */
export function sweepFinishedJobs<T extends object>(
  jobs: Map<string, T>,
  finished: (job: T) => boolean,
  ttlMs: number,
  now = Date.now(),
): void {
  for (const [id, job] of jobs) {
    if (!finished(job)) continue;
    const since = finishedSince.get(job) ?? now;
    finishedSince.set(job, since);
    if (now - since > ttlMs) jobs.delete(id);
  }
}
