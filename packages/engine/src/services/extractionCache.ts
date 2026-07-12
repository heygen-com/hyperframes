/**
 * Content-Addressed Extraction Cache
 *
 * Video frame extraction is the single most expensive phase of a render
 * after capture. Repeat renders of the same composition (preview → final,
 * studio iteration) re-extract identical frames from the same source file,
 * burning ffmpeg time that adds no value. This module keys extracted frame
 * bundles on the (path, mtime, size, mediaStart, duration, fps, format,
 * optional transform)
 * tuple so re-renders resolve to a pre-extracted directory instead of
 * re-invoking ffmpeg.
 *
 * ### Scheme
 *
 * - The key is the SHA-256 of a stable JSON encoding of the tuple above.
 * - Cache entries live under `<rootDir>/<SCHEMA_PREFIX><key[0..16]>/` so
 *   `ls` output and tracing logs stay short. Truncation to 16 hex chars
 *   leaves 64 bits of entropy — collision risk at cache scale is negligible.
 * - Frames are extracted into a unique `<entry>.partial-<pid>-<uuid>/` dir.
 *   Once all frames are written, the partial dir receives the `.hf-complete`
 *   sentinel and is atomically renamed to the final key dir. Concurrent
 *   same-key writers may duplicate ffmpeg work, but readers only ever serve
 *   complete entries.
 * - The sentinel mtime is touched on hits and used as the cache's LRU clock.
 *   `gcExtractionCache` evicts by that mtime and also clears old partial dirs
 *   left behind by crashed writers.
 *
 * ### Versioning
 *
 * `SCHEMA_PREFIX` bumps when the cache-contents invariant changes (e.g.
 * extraction format, frame layout). Old entries under the previous prefix
 * become inert and can be gc'd by the caller.
 */

import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { VideoMetadata } from "../utils/ffprobe.js";

/** Filename prefix for extracted frames. Shared with the extractor. */
export const FRAME_FILENAME_PREFIX = "frame_";

/** Sentinel filename written after a cache entry is fully populated. */
export const COMPLETE_SENTINEL = ".hf-complete";

/** Marker file stamped after each GC sweep; drives the staleness fallback. */
export const GC_MARKER = ".hf-last-gc";

/**
 * Current schema version. Bump when the cache-contents invariant changes.
 * v2 -> v3: one-pass VFR extraction (-fps_mode cfr) replaces the two-pass
 * VFR-to-CFR re-encode, changing frame contents for VFR sources under
 * identical key tuples. Without the bump, warm v2 entries (two-pass frames)
 * would keep being served across the deploy boundary.
 */
export const SCHEMA_PREFIX = "hfcache-v3-";

/** Truncated hex chars of SHA-256 used for the entry directory name. */
const KEY_HEX_CHARS = 16;

export type CacheFrameFormat = "jpg" | "png";

export interface CacheKeyInput {
  /** Absolute path to the source video file. Part of the key so moved files
   *  re-extract rather than match by (size, mtime) alone. */
  videoPath: string;
  /** Source file modification time in ms (floored). Invalidates the key on edit. */
  mtimeMs: number;
  /** Source file size in bytes. Invalidates the key on content change. */
  size: number;
  /** Seconds into source the composition starts reading (video.mediaStart). */
  mediaStart: number;
  /** Seconds of source the composition uses. Infinity is normalized to -1
   *  so callers that pass an unresolved "natural duration" still produce a
   *  stable key across invocations. */
  duration: number;
  /** Target output frames-per-second. */
  fps: number;
  /** Output image format. */
  format: CacheFrameFormat;
  /** Optional source transform applied during extraction. */
  transform?: string;
}

export interface CacheEntry {
  /** Absolute path to the cache entry directory. */
  dir: string;
  /** Full 64-char SHA-256 hex digest (parent of the truncated key). */
  keyHash: string;
}

export interface CacheLookup {
  /** Cache entry information — always returned even on a miss so the caller
   *  can derive a partial dir and publish it after extraction. */
  entry: CacheEntry;
  /** True when the entry exists AND carries the completion sentinel. */
  hit: boolean;
}

export interface CachePublishResult {
  dir: string;
  published: boolean;
}

/**
 * Read `(mtimeMs, size)` for a path. Returns `null` if the file is missing —
 * callers should skip the cache path for that entry so the extractor surfaces
 * the real file-not-found error. Returning a zero-stat sentinel would let two
 * missing files share the same `(0, 0)` tuple and pollute the cache with an
 * orphaned entry.
 */
export function readKeyStat(videoPath: string): { mtimeMs: number; size: number } | null {
  try {
    const stat = statSync(videoPath);
    return { mtimeMs: Math.floor(stat.mtimeMs), size: stat.size };
  } catch {
    return null;
  }
}

function canonicalKeyBlob(input: CacheKeyInput): string {
  const durationForKey = Number.isFinite(input.duration) ? input.duration : -1;
  const blob: {
    p: string;
    m: number;
    s: number;
    ms: number;
    d: number;
    f: number;
    fmt: CacheFrameFormat;
    t?: string;
  } = {
    p: input.videoPath,
    m: input.mtimeMs,
    s: input.size,
    ms: input.mediaStart,
    d: durationForKey,
    f: input.fps,
    fmt: input.format,
  };
  if (input.transform !== undefined) blob.t = input.transform;
  return JSON.stringify(blob);
}

/**
 * Compute the SHA-256 hex digest for a cache key input.
 */
export function computeCacheKey(input: CacheKeyInput): string {
  return createHash("sha256").update(canonicalKeyBlob(input)).digest("hex");
}

/**
 * Derive the truncated cache-entry directory name from a full key hash.
 * Exposed so tests and the entry dir resolver share one truncation rule.
 */
export function cacheEntryDirName(keyHash: string): string {
  return SCHEMA_PREFIX + keyHash.slice(0, KEY_HEX_CHARS);
}

/**
 * Look up a cache entry by key input. Returns the resolved entry path plus a
 * `hit` flag. On miss, callers should extract frames into a
 * `partialCacheEntryDir(entry)` directory and publish it with
 * `publishCacheEntry` once extraction succeeds.
 */
export function lookupCacheEntry(rootDir: string, input: CacheKeyInput): CacheLookup {
  const keyHash = computeCacheKey(input);
  const dir = join(rootDir, cacheEntryDirName(keyHash));
  const complete = existsSync(join(dir, COMPLETE_SENTINEL));
  return { entry: { dir, keyHash }, hit: complete };
}

/**
 * Ensure a cache entry's directory exists so the extractor can write into it.
 * Idempotent: `mkdirSync({recursive:true})` is a no-op when the dir exists.
 */
export function ensureCacheEntryDir(entry: CacheEntry): void {
  mkdirSync(entry.dir, { recursive: true });
}

/**
 * Unique render-owned directory used to populate a cache entry before the
 * atomic publish rename.
 */
export function partialCacheEntryDir(entry: CacheEntry): string {
  return `${entry.dir}.partial-${process.pid}-${randomUUID().slice(0, 8)}`;
}

function isTargetExistsRenameError(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException).code;
  return code === "EEXIST" || code === "ENOTEMPTY" || code === "EPERM";
}

/**
 * Publish an extracted partial directory as the final cache entry.
 *
 * Same-filesystem directory rename is atomic: readers either see no entry or
 * a complete sentineled entry. When another writer wins the race, the caller
 * should rehydrate from the final dir. If publish cannot complete safely, the
 * partial remains render-owned and must be cleaned up by the render cleanup.
 */
/**
 * If a concurrent writer's completed entry is visible, discard our partial
 * and serve theirs. Identical keys produce identical frames, so adopting the
 * winner is always correct. Returns null when no winner is present.
 */
function adoptPublishedWinner(entry: CacheEntry, partialDir: string): CachePublishResult | null {
  if (!existsSync(join(entry.dir, COMPLETE_SENTINEL))) return null;
  removeDir(partialDir);
  return { dir: entry.dir, published: true };
}

export function publishCacheEntry(entry: CacheEntry, partialDir: string): CachePublishResult {
  try {
    writeFileSync(join(partialDir, COMPLETE_SENTINEL), "", "utf-8");
  } catch {
    return { dir: partialDir, published: false };
  }

  try {
    renameSync(partialDir, entry.dir);
    return { dir: entry.dir, published: true };
  } catch (err) {
    if (!isTargetExistsRenameError(err)) return { dir: partialDir, published: false };
  }

  const winner = adoptPublishedWinner(entry, partialDir);
  if (winner) return winner;

  try {
    rmSync(entry.dir, { recursive: true, force: true });
  } catch {
    return { dir: partialDir, published: false };
  }

  try {
    renameSync(partialDir, entry.dir);
    return { dir: entry.dir, published: true };
  } catch {
    // TOCTOU: a concurrent writer can publish between the winner check, the
    // rm above, and this retry. Re-run the adopt check so a winner that
    // landed inside that window is served rather than reported as a failure.
    return adoptPublishedWinner(entry, partialDir) ?? { dir: partialDir, published: false };
  }
}

/**
 * Update the LRU clock for a complete cache entry. Misses and filesystem
 * races are harmless: the caller can still use the entry it already found.
 */
export function touchCacheEntry(entry: CacheEntry): void {
  try {
    const now = new Date();
    utimesSync(join(entry.dir, COMPLETE_SENTINEL), now, now);
  } catch {
    // Best effort LRU touch.
  }
}

/**
 * Write the completion sentinel so subsequent lookups treat this entry as a
 * hit. Must be called only after every frame has been written. The extractor
 * now publishes new entries via `publishCacheEntry`; this helper remains
 * exported for tests and legacy callers that materialize entries directly.
 *
 * Concurrency: direct mark is non-atomic and should not be used for shared
 * writer paths. `publishCacheEntry` writes the sentinel inside a partial dir
 * and atomically renames it into place, so concurrent writers duplicate work
 * but never serve torn frames.
 */
export function markCacheEntryComplete(entry: CacheEntry): void {
  writeFileSync(join(entry.dir, COMPLETE_SENTINEL), "", "utf-8");
}

/** Any generation of this cache's entries ("hfcache-v*"), current or superseded. */
const CACHE_GENERATION_PREFIX = "hfcache-v";

function isCacheLikeChild(name: string): boolean {
  // Match every schema generation, not just SCHEMA_PREFIX: after a schema
  // bump, superseded-version entries would otherwise be invisible to the
  // sweep and orphan their disk forever. Old-generation entries never get
  // sentinel touches, so the LRU evicts them first.
  return name.startsWith(CACHE_GENERATION_PREFIX) || name.includes(".partial-");
}

function isPartialChild(name: string): boolean {
  return name.includes(".partial-");
}

function directorySizeBytes(path: string): number {
  try {
    const stat = lstatSync(path);
    if (!stat.isDirectory()) return stat.size;
  } catch {
    return 0;
  }

  let total = 0;
  let children: string[];
  try {
    children = readdirSync(path);
  } catch {
    return 0;
  }

  for (const child of children) {
    const childPath = join(path, child);
    try {
      const stat = lstatSync(childPath);
      if (stat.isDirectory()) {
        total += directorySizeBytes(childPath);
      } else {
        total += stat.size;
      }
    } catch {
      // Ignore entries deleted or made unreadable during the sweep.
    }
  }
  return total;
}

function removeDir(path: string): void {
  try {
    rmSync(path, { recursive: true, force: true });
  } catch {
    // Cache GC is opportunistic; one bad entry must not abort the sweep.
  }
}

interface GcEntry {
  dir: string;
  size: number;
  lastUseMs: number;
  ageMs: number;
}

/**
 * Stat one cache-looking child for the GC sweep. Aged partial dirs (crashed
 * writers) are removed immediately and yield `null`; entries that disappear
 * or fail to stat mid-sweep also yield `null`.
 */
function collectGcEntry(
  dir: string,
  name: string,
  now: number,
  minAgeMs: number,
  stats: GcStats,
): GcEntry | null {
  try {
    const dirStat = statSync(dir);
    if (isPartialChild(name) && now - dirStat.mtimeMs >= minAgeMs) {
      removeDir(dir);
      stats.agedPartialsRemoved += 1;
      return null;
    }

    let lastUseMs = dirStat.mtimeMs;
    try {
      lastUseMs = statSync(join(dir, COMPLETE_SENTINEL)).mtimeMs;
    } catch {
      // Unsentineled entries use directory mtime as a stale-entry clock.
    }

    return { dir, size: directorySizeBytes(dir), lastUseMs, ageMs: now - lastUseMs };
  } catch {
    return null;
  }
}

export interface GcStats {
  /** Complete entries evicted by the LRU size sweep. */
  evictedEntries: number;
  /** Bytes reclaimed by evicted entries. */
  evictedBytes: number;
  /** Aged `.partial-*` dirs (crashed writers) removed. */
  agedPartialsRemoved: number;
}

/**
 * Opportunistic size-capped LRU cleanup for extracted video frames.
 *
 * Scans only direct cache-looking children and never throws. The age guard is
 * a liveness heuristic, not a lock. Returns counts so the caller can surface
 * eviction pressure in render observability.
 */
/**
 * Whether the staleness fallback should force a sweep: true when no sweep
 * marker exists or the last sweep is older than `maxAgeMs`. Lets 100%-warm
 * workloads (which skip the per-miss sweep) still reclaim space eventually.
 */
export function gcSweepDue(rootDir: string, maxAgeMs: number): boolean {
  try {
    return Date.now() - statSync(join(rootDir, GC_MARKER)).mtimeMs > maxAgeMs;
  } catch {
    return true;
  }
}

export function gcExtractionCache(
  rootDir: string,
  opts: { maxBytes: number; minAgeMs: number },
): GcStats {
  const stats: GcStats = { evictedEntries: 0, evictedBytes: 0, agedPartialsRemoved: 0 };
  try {
    writeFileSync(join(rootDir, GC_MARKER), "", "utf-8");
  } catch {
    // Unwritable root: the sweep below will no-op on the same root anyway.
  }
  try {
    const now = Date.now();
    const entries: GcEntry[] = [];
    for (const child of readdirSync(rootDir, { withFileTypes: true })) {
      if (!child.isDirectory() || !isCacheLikeChild(child.name)) continue;
      const entry = collectGcEntry(
        join(rootDir, child.name),
        child.name,
        now,
        opts.minAgeMs,
        stats,
      );
      if (entry) entries.push(entry);
    }

    let totalBytes = entries.reduce((sum, e) => sum + e.size, 0);
    if (totalBytes <= opts.maxBytes) return stats;

    entries.sort((a, b) => a.lastUseMs - b.lastUseMs);
    for (const entry of entries) {
      // ponytail: age-based liveness guard, not a lock; a render longer than minAge with a full cache could lose entries mid-read - acceptable, next render re-extracts.
      if (entry.ageMs < opts.minAgeMs) continue;
      removeDir(entry.dir);
      stats.evictedEntries += 1;
      stats.evictedBytes += entry.size;
      totalBytes -= entry.size;
      if (totalBytes <= opts.maxBytes) break;
    }
  } catch {
    // Missing root or unreadable cache: no cleanup this sweep.
  }
  return stats;
}

/**
 * Rebuild the in-memory frame index for a cached entry. Called on cache hits
 * so the extractor's caller receives the same `ExtractedFrames` shape it
 * would get from a fresh extraction — without re-running ffmpeg or ffprobe.
 *
 * The `metadata` argument is the `VideoMetadata` probed in the extractor's
 * Phase 2 (pre-preflight). Passing it here avoids an extra ffprobe on the
 * hit path.
 */
export interface RehydrateOptions {
  videoId: string;
  srcPath: string;
  fps: number;
  format: CacheFrameFormat;
  metadata: VideoMetadata;
}

export interface RehydratedFrames {
  videoId: string;
  srcPath: string;
  outputDir: string;
  framePattern: string;
  fps: number;
  totalFrames: number;
  metadata: VideoMetadata;
  framePaths: Map<number, string>;
}

export function rehydrateCacheEntry(
  entry: CacheEntry,
  options: RehydrateOptions,
): RehydratedFrames {
  const framePattern = `${FRAME_FILENAME_PREFIX}%05d.${options.format}`;
  const framePaths = new Map<number, string>();
  const suffix = `.${options.format}`;
  const files = readdirSync(entry.dir)
    .filter((f) => f.startsWith(FRAME_FILENAME_PREFIX) && f.endsWith(suffix))
    .sort();
  files.forEach((file, idx) => {
    framePaths.set(idx, join(entry.dir, file));
  });
  return {
    videoId: options.videoId,
    srcPath: options.srcPath,
    outputDir: entry.dir,
    framePattern,
    fps: options.fps,
    totalFrames: framePaths.size,
    metadata: options.metadata,
    framePaths,
  };
}
