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
import { mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { VideoMetadata } from "../utils/ffprobe.js";

/** Filename prefix for extracted frames. Shared with the extractor. */
export const FRAME_FILENAME_PREFIX = "frame_";

/** Sentinel filename written after a cache entry is fully populated. */
export const COMPLETE_SENTINEL = ".hf-complete";

/** Current schema version. Bump when cache-entry layout changes. */
export const SCHEMA_PREFIX = "hfcache-v2-";

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
  return JSON.stringify({
    p: input.videoPath,
    m: input.mtimeMs,
    s: input.size,
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
 * Idempotent: `mkdirSync({recursive:true})` is a no-op when the dir exists.
 */
export function ensureCacheEntryDir(entry: CacheEntry): void {
  mkdirSync(entry.dir, { recursive: true });
}

/**
 * Write the completion sentinel so subsequent lookups treat this entry as a
 * hit. Must be called only after every frame has been written.
 *
 * Concurrency: lookup→populate→mark is non-atomic. Two concurrent renders of
 * the same key may both miss, both extract into the same dir, and the later
 * writer's frames win. The result is correct (identical inputs yield identical
 * frames) but wasteful. Acceptable for a single-process render pipeline;
 * anyone running concurrent renders against a shared cache root should front
 * it with an external lock.
 */
export function markCacheEntryComplete(entry: CacheEntry): void {
  writeFileSync(join(entry.dir, COMPLETE_SENTINEL), "", "utf-8");
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
