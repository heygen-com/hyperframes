/**
 * Content-Addressed Extraction Cache
 *
 * Video frame extraction is the single most expensive phase of a render
 * after capture. Repeat renders of the same composition (preview → final,
 * studio iteration) re-extract identical frames from the same source file,
 * burning ffmpeg time that adds no value. This module keys extracted frame
 * bundles on the (path, mtime, size, mediaStart, duration, fps, format)
 * tuple so re-renders resolve to a pre-extracted directory instead of
 * re-invoking ffmpeg.
 *
 * ### Scheme
 *
 * - The key is the SHA-256 of a stable JSON encoding of the tuple above.
 * - Cache entries live under `<rootDir>/<SCHEMA_PREFIX><key[0..16]>/` so
 *   `ls` output and tracing logs stay short. Truncation to 16 hex chars
 *   leaves 64 bits of entropy — collision risk at cache scale is negligible.
 * - A completed entry is marked by writing the `.hf-complete` sentinel file
 *   after all frames are on disk. A dir without the sentinel is treated as
 *   absent (stale/abandoned) and re-extracted into a fresh key (the old dir
 *   is left for external gc — the cache owns keys, not deletion policy).
 *
 * ### Versioning
 *
 * `SCHEMA_PREFIX` bumps when the cache-contents invariant changes (e.g.
 * extraction format, frame layout). Old entries under the previous prefix
 * become inert and can be gc'd by the caller.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Filename prefix for extracted frames. Shared with the extractor. */
export const FRAME_FILENAME_PREFIX = "frame_";

/** Sentinel filename written after a cache entry is fully populated. */
export const COMPLETE_SENTINEL = ".hf-complete";

/** Current schema version. Bump when cache-entry layout changes. */
export const SCHEMA_PREFIX = "hfcache-v2-";

/** Truncated hex chars of SHA-256 used for the entry directory name. */
const KEY_HEX_CHARS = 16;

export interface CacheKeyInput {
  /** Absolute path to the source video file. Path is part of the key so
   *  moved files re-extract rather than match by (size, mtime) alone. */
  videoPath: string;
  /** Seconds into source the composition starts reading (video.mediaStart). */
  mediaStart: number;
  /** Seconds of source the composition uses. Infinity is normalized to -1
   *  so callers that pass an unresolved "natural duration" still produce a
   *  stable key across invocations. */
  duration: number;
  /** Target output frames-per-second. */
  fps: number;
  /** Output image format ("jpg" | "png"). */
  format: string;
}

export interface CacheEntry {
  /** Absolute path to the cache entry directory. */
  dir: string;
  /** Full 64-char SHA-256 hex digest (parent of the truncated key). */
  keyHash: string;
}

export interface CacheLookup {
  /** Cache entry information — always returned even on a miss so the caller
   *  can extract directly into `dir` then call `markCacheEntryComplete`. */
  entry: CacheEntry;
  /** True when the entry exists AND carries the completion sentinel. */
  hit: boolean;
}

/**
 * Canonical JSON serialization for the key input. Keys are listed
 * explicitly to prevent property-order variance across Node versions from
 * producing different hashes for the same logical input. mtime/size are
 * captured from the source file at key-compute time so a file edit
 * invalidates the key even when path/mediaStart/duration/fps don't change.
 */
function canonicalKeyBlob(input: CacheKeyInput): string {
  let mtimeMs = 0;
  let size = 0;
  try {
    const stat = statSync(input.videoPath);
    mtimeMs = Math.floor(stat.mtimeMs);
    size = stat.size;
  } catch {
    // If the file disappears between Phase 1 resolution and key compute, the
    // missing (mtime, size) still gives a stable key — just one that won't
    // match any real entry, so we'll miss and the extractor will fail with
    // its normal file-not-found path. Don't throw here; the extractor is the
    // right place to surface that error.
  }

  const durationForKey = Number.isFinite(input.duration) ? input.duration : -1;

  // Properties are written in a fixed order.
  return JSON.stringify({
    p: input.videoPath,
    m: mtimeMs,
    s: size,
    ms: input.mediaStart,
    d: durationForKey,
    f: input.fps,
    fmt: input.format,
  });
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
 * `hit` flag. On miss, callers should extract frames into `entry.dir`
 * (after calling `ensureCacheEntryDir`) and then call `markCacheEntryComplete`
 * once the extraction succeeds.
 */
export function lookupCacheEntry(rootDir: string, input: CacheKeyInput): CacheLookup {
  const keyHash = computeCacheKey(input);
  const dir = join(rootDir, cacheEntryDirName(keyHash));
  const complete = existsSync(join(dir, COMPLETE_SENTINEL));
  return { entry: { dir, keyHash }, hit: complete };
}

/**
 * Ensure a cache entry's directory exists so the extractor can write into it.
 * Idempotent — creates missing parents recursively.
 */
export function ensureCacheEntryDir(entry: CacheEntry): void {
  if (!existsSync(entry.dir)) mkdirSync(entry.dir, { recursive: true });
}

/**
 * Write the completion sentinel so subsequent lookups treat this entry as a
 * hit. Must be called only after every frame has been written and the
 * directory is considered durable.
 */
export function markCacheEntryComplete(entry: CacheEntry): void {
  const sentinelPath = join(entry.dir, COMPLETE_SENTINEL);
  writeFileSync(sentinelPath, "", "utf-8");
}
