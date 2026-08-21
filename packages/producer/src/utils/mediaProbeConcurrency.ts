import { Semaphore } from "./semaphore.js";

const MEDIA_PROBE_CONCURRENCY = 4;

/**
 * Process-wide because compiler advisories can outlive compileForRender and
 * overlap the later media-type preflight. A per-phase limiter would still let
 * those independently scheduled probe pools multiply subprocess load.
 */
export const sharedMediaProbeSemaphore = new Semaphore(MEDIA_PROBE_CONCURRENCY);

export async function withMediaProbeSlot<T>(operation: () => Promise<T>): Promise<T> {
  const release = await sharedMediaProbeSemaphore.acquire();
  try {
    return await operation();
  } finally {
    release();
  }
}
