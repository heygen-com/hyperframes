import { existsSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { extname, join } from "node:path";
import { PROXY_VARIANT_CONFIG } from "./mediaCodecMap.js";

const DEFAULT_MAX_BYTES = 10 * 1024 * 1024 * 1024;
const DEFAULT_STALE_TEMP_MS = 60 * 60 * 1000;
const DEFAULT_MIN_SWEEP_INTERVAL_MS = 5 * 60 * 1000;
const PROXY_EXTENSIONS: ReadonlySet<string> = new Set(
  Object.values(PROXY_VARIANT_CONFIG).map(({ extension }) => extension),
);

export interface ProxyCacheCleanupOptions {
  maxBytes?: number;
  maxIdleMs?: number;
  staleTempMs?: number;
  minSweepIntervalMs?: number;
  protectedPaths?: ReadonlySet<string>;
  now?: number;
}

export interface ProxyCacheCleanupResult {
  removed: string[];
  bytesBefore: number;
  bytesAfter: number;
  skipped: boolean;
}

interface CacheEntry {
  path: string;
  size: number;
  modifiedAt: number;
  protected: boolean;
}

const lastSweepAt = new Map<string, number>();

function positiveEnvNumber(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function proxyCacheCleanupDefaults(): Required<
  Pick<ProxyCacheCleanupOptions, "maxBytes" | "maxIdleMs" | "staleTempMs" | "minSweepIntervalMs">
> {
  return {
    maxBytes: positiveEnvNumber("HYPERFRAMES_PROXY_CACHE_MAX_BYTES", DEFAULT_MAX_BYTES),
    maxIdleMs: positiveEnvNumber("HYPERFRAMES_PROXY_CACHE_MAX_IDLE_DAYS", 30) * 24 * 60 * 60 * 1000,
    staleTempMs: positiveEnvNumber("HYPERFRAMES_PROXY_CACHE_STALE_TEMP_MS", DEFAULT_STALE_TEMP_MS),
    minSweepIntervalMs: positiveEnvNumber(
      "HYPERFRAMES_PROXY_CACHE_SWEEP_INTERVAL_MS",
      DEFAULT_MIN_SWEEP_INTERVAL_MS,
    ),
  };
}

function shouldSkipSweep(cacheDir: string, now: number, minSweepIntervalMs: number): boolean {
  const previousSweep = lastSweepAt.get(cacheDir);
  if (previousSweep !== undefined && now - previousSweep < minSweepIntervalMs) return true;
  lastSweepAt.set(cacheDir, now);
  return false;
}

function readCacheInventory(
  cacheDir: string,
  protectedPaths: ReadonlySet<string>,
  now: number,
  staleTempMs: number,
): { entries: CacheEntry[]; staleTemps: CacheEntry[] } {
  const entries: CacheEntry[] = [];
  const staleTemps: CacheEntry[] = [];
  for (const dirent of readdirSync(cacheDir, { withFileTypes: true })) {
    if (!dirent.isFile()) continue;
    const path = join(cacheDir, dirent.name);
    const stat = statSync(path);
    const entry = {
      path,
      size: stat.size,
      modifiedAt: stat.mtimeMs,
      protected: protectedPaths.has(path),
    };
    if (dirent.name.startsWith(".tmp-")) {
      if (now - stat.mtimeMs >= staleTempMs) staleTemps.push(entry);
    } else if (PROXY_EXTENSIONS.has(extname(dirent.name))) {
      entries.push(entry);
    }
  }
  const oldestFirst = (a: CacheEntry, b: CacheEntry): number =>
    a.modifiedAt - b.modifiedAt || a.path.localeCompare(b.path);
  entries.sort(oldestFirst);
  staleTemps.sort(oldestFirst);
  return { entries, staleTemps };
}

function evictCacheEntries(
  entries: CacheEntry[],
  staleTemps: CacheEntry[],
  now: number,
  maxIdleMs: number,
  maxBytes: number,
): Omit<ProxyCacheCleanupResult, "skipped"> {
  const bytesBefore = entries.reduce((total, entry) => total + entry.size, 0);
  let bytesAfter = bytesBefore;
  const removed: string[] = [];
  const remove = (entry: CacheEntry, countsTowardBudget: boolean): void => {
    unlinkSync(entry.path);
    removed.push(entry.path);
    if (countsTowardBudget) bytesAfter -= entry.size;
  };

  for (const entry of staleTemps) remove(entry, false);
  for (const entry of entries) {
    if (!entry.protected && now - entry.modifiedAt >= maxIdleMs) remove(entry, true);
  }
  for (const entry of entries) {
    if (bytesAfter <= maxBytes) break;
    if (!entry.protected && existsSync(entry.path)) remove(entry, true);
  }
  return { removed, bytesBefore, bytesAfter };
}

/**
 * Opportunistically bounds a project's transparent-proxy cache. Cleanup is
 * synchronous because callers already perform filesystem bookkeeping on the
 * preview request path, but rate limiting keeps the directory scan off the
 * hot path. Errors intentionally bubble so callers can warn without turning
 * a cache-maintenance failure into a preview failure.
 */
export function cleanupProxyCache(
  cacheDir: string,
  options: ProxyCacheCleanupOptions = {},
): ProxyCacheCleanupResult {
  const defaults = proxyCacheCleanupDefaults();
  const now = options.now ?? Date.now();
  const minSweepIntervalMs = options.minSweepIntervalMs ?? defaults.minSweepIntervalMs;
  if (shouldSkipSweep(cacheDir, now, minSweepIntervalMs)) {
    return { removed: [], bytesBefore: 0, bytesAfter: 0, skipped: true };
  }
  if (!existsSync(cacheDir)) {
    return { removed: [], bytesBefore: 0, bytesAfter: 0, skipped: false };
  }

  const maxBytes = options.maxBytes ?? defaults.maxBytes;
  const maxIdleMs = options.maxIdleMs ?? defaults.maxIdleMs;
  const staleTempMs = options.staleTempMs ?? defaults.staleTempMs;
  const protectedPaths = options.protectedPaths ?? new Set<string>();
  const { entries, staleTemps } = readCacheInventory(cacheDir, protectedPaths, now, staleTempMs);
  return {
    ...evictCacheEntries(entries, staleTemps, now, maxIdleMs, maxBytes),
    skipped: false,
  };
}
