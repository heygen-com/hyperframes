// The adapter finishes a job in place, so its finish time is when a sweep first sees it finished.
const firstSeenFinishedAt = new WeakMap<object, number>();

export function forgetJobsFinishedLongerThan<T extends object>(
  ttlMs: number,
  jobs: Map<string, T>,
  isFinished: (job: T) => boolean,
  now = Date.now(),
): void {
  for (const [id, job] of jobs) {
    if (!isFinished(job)) continue;
    const finishedAt = firstSeenFinishedAt.get(job) ?? now;
    firstSeenFinishedAt.set(job, finishedAt);
    if (now - finishedAt > ttlMs) jobs.delete(id);
  }
}
