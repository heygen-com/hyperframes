/**
 * Frame Directory Max-Index Cache
 *
 * Module-scoped cache of the maximum 1-based frame index present in each
 * pre-extracted frame directory (e.g. `frame_0001.png … frame_0150.png` → 150).
 * The directory is read once on first access and the max is computed by parsing
 * filenames.
 *
 * Used by the render orchestrator to bounds-check `videoFrameIndex` against
 * the directory size before calling `existsSync` per frame, which avoids
 * redundant filesystem syscalls when the requested time falls past the last
 * extracted frame (e.g. a clip shorter than the composition's effective video
 * range).
 *
 * The cache is module-scoped on purpose: it must be shared across the many
 * frame-capture call sites within a single render job. To prevent it from
 * growing monotonically across jobs (Chunk 5B), callers MUST invoke
 * `clearMaxFrameIndex(frameDir)` for every directory they registered, in their
 * cleanup path. The render orchestrator does this in its outer `finally`.
 *
 * As defense in depth (PR #381 review feedback), the cache also enforces a
 * hard MAX_ENTRIES cap with LRU eviction. The orchestrator's `finally`
 * remains the primary boundedness mechanism; the LRU cap exists so that a
 * future code path which forgets to call `clearMaxFrameIndex` cannot leak
 * memory without bound — it self-limits to a working set ~100× larger than a
 * single job needs.
 *
 * Lives in its own module (rather than as a private to renderOrchestrator.ts)
 * so the cross-job isolation contract can be unit-tested directly.
 */

import { readdirSync } from "fs";

const cache = new Map<string, number>();

const FRAME_FILENAME_RE = /^frame_(\d+)\.png$/;

/**
 * Hard upper bound on cached entries. Sized at ~100× the working set of a
 * single render job (which typically registers <10 frame directories, one
 * per HDR video source) so that well-behaved callers never trip the cap.
 *
 * Worst-case resident size: 1000 × (~64-byte path string + ~24-byte map
 * entry) ≈ 88 KB. Cheap insurance.
 *
 * Exported for observability and tests. Production code MUST NOT branch on
 * this value to gate behavior — the cap is intentionally invisible to
 * callers that follow the clearMaxFrameIndex contract.
 */
export const MAX_ENTRIES = 1000;

/**
 * Returns the maximum 1-based frame index found in `frameDir`, computed by
 * parsing `frame_NNNN.png` filenames. Subsequent calls with the same path
 * return the cached value without touching the filesystem. Returns 0 if the
 * directory is missing, unreadable, or contains no frame files.
 *
 * On every access (hit or miss), the entry is bumped to most-recently-used so
 * that the LRU-eviction path under cache pressure removes the entry that has
 * been idle longest, not whichever one happened to be inserted earliest.
 */
export function getMaxFrameIndex(frameDir: string): number {
  const cached = cache.get(frameDir);
  if (cached !== undefined) {
    // Bump recency: Map preserves insertion order for iteration, so
    // delete-then-set moves the entry to the end (most-recently-used). This
    // turns the simple Map into an O(1) approximate LRU without pulling in
    // a doubly-linked list.
    cache.delete(frameDir);
    cache.set(frameDir, cached);
    return cached;
  }
  let max = 0;
  try {
    for (const name of readdirSync(frameDir)) {
      const m = FRAME_FILENAME_RE.exec(name);
      if (!m) continue;
      const n = Number(m[1]);
      if (Number.isFinite(n) && n > max) max = n;
    }
  } catch {
    // Directory missing or unreadable → max stays 0; downstream existsSync
    // check will still produce the right "no frame" outcome.
  }
  // Evict the oldest entry before inserting when at cap. Map.keys().next()
  // returns the first inserted key, which after our delete-and-reinsert
  // dance on hits is also the least-recently-used entry.
  if (cache.size >= MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(frameDir, max);
  return max;
}

/**
 * Removes the cached max-index for a single directory. Called by the render
 * orchestrator in its cleanup path so that subsequent jobs do not inherit
 * stale entries (or worse, hold references to torn-down workDir paths).
 *
 * Returns `true` if an entry was removed, `false` if the path was not cached.
 */
export function clearMaxFrameIndex(frameDir: string): boolean {
  return cache.delete(frameDir);
}

/**
 * Returns the current number of cached entries. Intended for tests and
 * diagnostic logging only — production code should not branch on this value.
 */
export function getMaxFrameIndexCacheSize(): number {
  return cache.size;
}

/**
 * Drops every cached entry. Intended exclusively for tests that need to
 * reset module state between cases. Production code MUST use
 * `clearMaxFrameIndex` for the directories it owns.
 *
 * @internal
 */
export function __resetMaxFrameIndexCacheForTests(): void {
  cache.clear();
}
