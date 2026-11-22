import { useLayoutEffect, useRef, type MutableRefObject, type RefObject } from "react";
import type { PublishSdkSession } from "../utils/sdkCutover";
import { forgetTimelineOptimisticGestures } from "../player/components/timelineOptimisticRevision";

/** The editor's one timeline edit queue. `placed` holds, per project, a promise that rejects
 *  when an edit of that project still pending is refused. */
export interface TimelineEditQueue extends MutableRefObject<Promise<void>> {
  /** Per project, a promise that rejects when an edit of that project still pending is refused. */
  placed?: Map<string | null, Promise<void>>;
  readonly projectId: string | null;
  readonly shownProjectId?: { readonly current: string | null };
}

export function useTimelineEditQueue(projectId: string | null): TimelineEditQueue {
  const shownProjectId = useRef(projectId);
  shownProjectId.current = projectId;
  const owner = useRef<TimelineEditQueue | null>(null);
  if (owner.current?.projectId !== projectId) {
    const { current = Promise.resolve(), placed = new Map() } = owner.current ?? {};
    owner.current = { current, placed, projectId, shownProjectId };
  }
  useLayoutEffect(() => () => forgetTimelineOptimisticGestures(), [projectId]);
  return owner.current;
}

export const isClosed = (queue: TimelineEditQueue) =>
  queue.shownProjectId !== undefined && queue.shownProjectId.current !== queue.projectId;

/** Runs a queued edit's live-preview or timeline-store side only while its project is shown. */
export function whileShown(queue: TimelineEditQueue, effect: () => void): void {
  if (!isClosed(queue)) effect();
}

/** A queued edit's way to the live preview, inert once its project is no longer shown. */
export function shownPreview(
  queue: TimelineEditQueue,
  live: {
    iframeRef: RefObject<HTMLIFrameElement | null>;
    reloadPreview: () => void;
    publishSdkSession?: PublishSdkSession;
  },
) {
  const publish = live.publishSdkSession;
  return {
    iframe: () => (isClosed(queue) ? null : live.iframeRef.current),
    reload: () => whileShown(queue, live.reloadPreview),
    publish:
      publish &&
      ((publication: Parameters<PublishSdkSession>[0]) =>
        isClosed(queue) ? ("rejected-inactive-target" as const) : publish(publication)),
  };
}

export const refuseWithEarlier = (error: unknown): never => {
  throw error;
};

/** Runs `run` after every edit queued before it. When one of those, in the same project, was
 *  refused, `ifEarlierRefused` runs first, and throwing refuses this edit too. */
export function enqueueTimelineEdit<T>(
  queue: TimelineEditQueue,
  run: (projectId: string) => Promise<T>,
  {
    label,
    ifEarlierRefused,
    projectId = queue.projectId,
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
    if (!projectId) throw new Error("No project to save this edit to");
    return run(projectId);
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
