import { useRef, type MutableRefObject } from "react";

/** The editor's one timeline edit queue. `placed` rejects when an edit still pending is refused. */
export interface TimelineEditQueue extends MutableRefObject<Promise<void>> {
  placed?: Promise<void>;
}

/** One queue per project, so a refusal in one project never touches another's edits. */
export function useTimelineEditQueue(projectId: string | null): TimelineEditQueue {
  const owner = useRef<{ projectId: string | null; queue: TimelineEditQueue } | null>(null);
  if (owner.current?.projectId !== projectId) {
    owner.current = { projectId, queue: { current: Promise.resolve() } };
  }
  return owner.current.queue;
}

export const refuseWithEarlier = (error: unknown): never => {
  throw error;
};

/** Runs `run` after every edit queued before it. When one of those was refused, `ifEarlierRefused`
 *  runs first, and throwing refuses this edit too. */
export function enqueueTimelineEdit<T>(
  queue: TimelineEditQueue,
  run: () => Promise<T>,
  { label, ifEarlierRefused }: { label?: string; ifEarlierRefused?: (error: unknown) => void } = {},
): Promise<T> {
  const earlier = queue.placed ?? Promise.resolve();
  const task = queue.current.then(async () => {
    if (ifEarlierRefused) await earlier.catch(ifEarlierRefused);
    return run();
  });
  const placed = Promise.allSettled([earlier, task]).then((settled) => {
    for (const result of settled) if (result.status === "rejected") throw result.reason;
  });
  queue.placed = placed;
  queue.current = task.then(
    () => undefined,
    (error) => {
      if (label) console.error(`[Timeline] Failed to persist: ${label}`, error);
    },
  );
  void placed
    .catch(() => undefined)
    .then(() => {
      if (queue.placed === placed) queue.placed = undefined;
    });
  return task;
}
