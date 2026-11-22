import type { MutableRefObject } from "react";
import { usePlayerStore } from "../player";
import {
  landsOnLaneClip,
  laneOverlapRefusal,
  type LaneLanding,
} from "../player/components/timelineCollision";

/** The editor's one timeline edit queue. `placed` holds, per project, a promise that rejects
 *  when an edit of that project still pending is refused. */
export interface TimelineEditQueue extends MutableRefObject<Promise<void>> {
  placed?: Map<string | null, Promise<void>>;
}

export const refuseWithEarlier = (error: unknown): never => {
  throw error;
};

/** For an edit the user placed, such as a drop: kept unless it now overlaps a lane clip. */
export const keepUnlessItOverlaps =
  (changes: ReadonlyArray<Pick<LaneLanding, "element" | "start">>) => () => {
    const { elements } = usePlayerStore.getState();
    const shown = new Map(elements.map((e) => [e.key ?? e.id, e]));
    const placed = changes.map(({ element, start }) => ({
      element: shown.get(element.key ?? element.id) ?? element,
      start,
    }));
    if (landsOnLaneClip(elements, placed)) throw laneOverlapRefusal();
  };

/** Runs `run` after every edit queued before it. When one of those, in the same project, was
 *  refused, `ifEarlierRefused` runs first, and throwing refuses this edit too. */
export function enqueueTimelineEdit<T>(
  queue: TimelineEditQueue,
  run: () => Promise<T>,
  {
    label,
    ifEarlierRefused,
    projectId = null,
  }: {
    label?: string;
    ifEarlierRefused?: (error: unknown) => void;
    projectId?: string | null;
  } = {},
): Promise<T> {
  const byProject = (queue.placed ??= new Map());
  const earlier = byProject.get(projectId) ?? Promise.resolve();
  const task = queue.current.then(async () => {
    if (ifEarlierRefused) await earlier.catch(ifEarlierRefused);
    return run();
  });
  const placed = Promise.allSettled([earlier, task]).then((settled) => {
    for (const result of settled) if (result.status === "rejected") throw result.reason;
  });
  byProject.set(projectId, placed);
  queue.current = task.then(
    () => undefined,
    (error) => {
      if (label) console.error(`[Timeline] Failed to persist: ${label}`, error);
    },
  );
  void placed
    .catch(() => undefined)
    .then(() => {
      if (byProject.get(projectId) === placed) byProject.delete(projectId);
    });
  return task;
}
