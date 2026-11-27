import { useCallback, useMemo, useRef, type RefObject } from "react";
import { refusedPreviewStatus } from "@hyperframes/core/studio-preview-mark";

/** What a shadow reload gives as its cause when it ran out its wait budgets. */
export const READY_TIMEOUT_CAUSE = "it took too long to load";
export const SHADOW_RETRY_DELAY_MS = 2_000;
export const BUSY_PAGE_RETRIES = 3;
const MIN_BUSY_WAIT_MS = 1_000;
const MAX_BUSY_WAIT_MS = 30_000;

/** More tries for a reload that timed out (once) or whose server said busy (503, after its Retry-After), so an edit is
 * not left unseen behind the old preview. A newer reload or a composition switch in the meantime cancels it. */
export function useShadowReloadRetry(
  generation: RefObject<number>,
  url: RefObject<string>,
  begin: RefObject<(url: string) => void>,
) {
  const retried = useRef(false);
  const refusedTries = useRef(0);
  const retrying = useRef(false);
  const cancelRef = useRef(() => {});

  const retryWhenVisible = useCallback(
    (failedGen: number, delayMs: number) => {
      const schedule = () => {
        const timer = setTimeout(() => {
          cancelRef.current = () => {};
          if (generation.current !== failedGen) return;
          const next = new URL(url.current, window.location.origin);
          next.searchParams.set("_t", String(Date.now()));
          retrying.current = true;
          begin.current(next.toString());
        }, delayMs);
        cancelRef.current = () => {
          clearTimeout(timer);
          cancelRef.current = () => {};
        };
      };
      if (document.visibilityState !== "hidden") return schedule();
      const onVisible = () => {
        if (document.visibilityState === "hidden") return;
        document.removeEventListener("visibilitychange", onVisible);
        schedule();
      };
      document.addEventListener("visibilitychange", onVisible);
      cancelRef.current = () => {
        document.removeEventListener("visibilitychange", onVisible);
        cancelRef.current = () => {};
      };
    },
    [generation, url, begin],
  );

  /** A reload failed with `cause` as generation `failedGen`: a timeout is retried once, a busy page a few times. */
  const afterFailure = useCallback(
    (cause: string, failedGen: number, retryAfterMs?: number): "asking-again" | "done" => {
      if (refusedPreviewStatus(cause) === 503) {
        if (retryAfterMs === undefined || refusedTries.current >= BUSY_PAGE_RETRIES) return "done";
        refusedTries.current += 1;
        cancelRef.current();
        retryWhenVisible(
          failedGen,
          Math.min(Math.max(retryAfterMs, MIN_BUSY_WAIT_MS), MAX_BUSY_WAIT_MS),
        );
        return "asking-again";
      }
      if (cause !== READY_TIMEOUT_CAUSE || retried.current) return "done";
      retried.current = true;
      cancelRef.current();
      retryWhenVisible(failedGen, SHADOW_RETRY_DELAY_MS);
      return "done";
    },
    [retryWhenVisible],
  );
  /** A reload starts: a request of its own gets its own retry; the retry itself does not. */
  const started = useCallback(() => {
    cancelRef.current();
    if (!retrying.current) {
      retried.current = false;
      refusedTries.current = 0;
    }
    retrying.current = false;
  }, []);
  /** The pending retry, if any, is dropped. */
  const cancel = useCallback(() => cancelRef.current(), []);
  return useMemo(() => ({ afterFailure, started, cancel }), [afterFailure, started, cancel]);
}
