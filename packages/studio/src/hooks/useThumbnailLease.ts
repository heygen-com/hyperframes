import { useCallback, useEffect, useLayoutEffect, useRef, useSyncExternalStore } from "react";
import {
  createThumbnailRequestIdentity,
  thumbnailScheduler,
  type ThumbnailRequest,
  type ThumbnailScheduler,
  type ThumbnailSnapshot,
} from "../player/lib/thumbnailScheduler";

const IDLE: ThumbnailSnapshot = Object.freeze({ status: "idle" });

export function useThumbnailLease(
  request: ThumbnailRequest | null,
  scheduler: ThumbnailScheduler = thumbnailScheduler,
): ThumbnailSnapshot {
  const requestRef = useRef(request);
  const leaseRef = useRef<ReturnType<ThumbnailScheduler["acquire"]> | null>(null);
  const identity = request ? createThumbnailRequestIdentity(request) : null;
  const priority = request?.priority;

  // `subscribe` is keyed on the identity, not on the request object, so that a
  // fresh object with the same identity does not release and re-acquire the
  // lease every render. It still has to reach the CURRENT request for its
  // `load` and `priority`, hence the ref, refreshed on commit: React calls
  // `subscribe` from a passive effect, and this effect is declared first, so it
  // has already run by then.
  useEffect(() => {
    requestRef.current = request;
  });

  const subscribe = useCallback(
    (listener: () => void) => {
      const current = requestRef.current;
      if (!current || identity === null) return () => {};
      const lease = scheduler.acquire(current, listener);
      leaseRef.current = lease;
      return () => {
        if (leaseRef.current === lease) leaseRef.current = null;
        lease.release();
      };
    },
    [identity, scheduler],
  );

  // Read during render, so it takes the request straight from the arguments: a
  // ref would still hold the previous one on the render that changes identity,
  // and the scheduler derives the entry it looks up from what it is handed.
  const getSnapshot = useCallback(
    () => (request && identity !== null ? scheduler.getSnapshot(request) : IDLE),
    [request, identity, scheduler],
  );

  useLayoutEffect(() => {
    if (priority) leaseRef.current?.updatePriority(priority);
  }, [priority]);

  return useSyncExternalStore(subscribe, getSnapshot, () => IDLE);
}
