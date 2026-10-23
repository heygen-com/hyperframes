import type { TimelineElement } from "../player";

/** A razor click captured while the preview refresh from an earlier cut is still in flight. */
export interface QueuedRazorSplit {
  mode: "single" | "all";
  track?: number;
  splitTime: number;
}

export interface RazorSplitRefreshGateDeps {
  getElements: () => readonly TimelineElement[];
  subscribe: (listener: () => void) => () => void;
  replay: (queued: QueuedRazorSplit) => Promise<void>;
  timeoutMs?: number;
}

export interface RazorSplitRefreshGate {
  isArmed: () => boolean;
  arm: () => void;
  offer: (item: QueuedRazorSplit) => boolean;
  flushWithoutRefresh: () => void;
  dispose: () => void;
}

/**
 * Queues razor clicks from the window between a committed cut and the preview
 * refresh that rebuilds the element list: a cut made inside that window reads
 * stale clip bounds, and the server rejects it as outside the clip's authored
 * bounds. Draining replays each click through `replay`, which re-targets
 * against the refreshed store. A timeout drain keeps clicks from stranding
 * when a refresh never lands; flushWithoutRefresh covers cuts that failed
 * without changing the file, where no refresh is coming either.
 */
export function createRazorSplitRefreshGate(
  deps: RazorSplitRefreshGateDeps,
): RazorSplitRefreshGate {
  const timeoutMs = deps.timeoutMs ?? 15_000;
  let baseline: readonly TimelineElement[] = [];
  let unsubscribe: (() => void) | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let queued: QueuedRazorSplit[] = [];
  let draining = false;

  const teardown = () => {
    unsubscribe?.();
    unsubscribe = null;
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const drain = () => {
    if (draining || unsubscribe === null) return;
    teardown();
    draining = true;
    const pending = queued;
    queued = [];
    void (async () => {
      try {
        for (const item of pending) await deps.replay(item);
      } finally {
        draining = false;
      }
    })();
  };

  return {
    isArmed: () => unsubscribe !== null,
    arm: () => {
      if (unsubscribe !== null) return;
      baseline = deps.getElements();
      unsubscribe = deps.subscribe(() => {
        if (deps.getElements() !== baseline) drain();
      });
      timer = setTimeout(drain, timeoutMs);
    },
    offer: (item: QueuedRazorSplit): boolean => {
      if (unsubscribe === null) return false;
      queued.push(item);
      return true;
    },
    flushWithoutRefresh: () => {
      drain();
    },
    dispose: () => {
      queued = [];
      teardown();
    },
  };
}
