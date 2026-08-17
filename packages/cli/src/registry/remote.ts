/**
 * Remote Registry Fetching
 *
 * Fetches registry manifests and item files from a Hyperframes registry hosted
 * on GitHub (or any HTTPS endpoint serving the same file layout).
 *
 * Base URL layout:
 *   <base>/registry.json                    → top-level manifest
 *   <base>/<type-dir>/<name>/registry-item.json
 *   <base>/<type-dir>/<name>/<file.path>    → individual files referenced by the item
 *
 * `<type-dir>` comes from ITEM_TYPE_DIRS in @hyperframes/core.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import {
  ITEM_TYPE_DIRS,
  type FileTarget,
  type ItemType,
  type RegistryItem,
  type RegistryManifest,
} from "@hyperframes/core";

export const DEFAULT_REGISTRY_URL =
  "https://raw.githubusercontent.com/heygen-com/hyperframes/main/registry";

const FETCH_TIMEOUT_MS = 10_000;

// ── Caching ─────────────────────────────────────────────────────────────────
// 24h TTL on manifest fetches so the interactive picker stays snappy offline.
// Item files aren't cached — they're written straight to destDir on install.

const CACHE_DIR = join(homedir(), ".hyperframes", "cache");
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

interface CacheEntry<T> {
  fetchedAt: number;
  data: T;
}

function cachePath(baseUrl: string, key: string): string {
  const slug = baseUrl.replace(/[^a-zA-Z0-9]/g, "_");
  return join(CACHE_DIR, `${slug}__${key}.json`);
}

/**
 * Read a cache entry regardless of age. Freshness is deliberately NOT decided
 * here: a fresh entry lets a caller skip the network, and a stale one is still
 * the best answer available once the network has already failed. Collapsing
 * the two (returning undefined past the TTL) made a 25-hour-old manifest and
 * no manifest at all indistinguishable, so one timeout against the registry
 * host reported the entire catalog as unreachable and sent authors off to
 * hand-write what they already had on disk.
 */
function readCacheEntry<T>(path: string): CacheEntry<T> | undefined {
  try {
    const entry = JSON.parse(readFileSync(path, "utf-8")) as CacheEntry<T>;
    if (typeof entry.fetchedAt !== "number") return undefined;
    // The callers now test the entry rather than the payload, so an empty
    // payload would satisfy them: `null` data would short-circuit the fetch
    // and be handed back as a RegistryItem. Rejecting it here keeps the miss
    // failing toward "go ask the network" rather than toward "the catalog is
    // empty", which is the whole point of the change around it.
    if (entry.data === undefined || entry.data === null) return undefined;
    return entry;
  } catch {
    // Missing file or corrupt JSON → cache miss.
    return undefined;
  }
}

function isFresh<T>(entry: CacheEntry<T>): boolean {
  return Date.now() - entry.fetchedAt <= CACHE_TTL_MS;
}

function writeCache<T>(path: string, data: T): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    const entry: CacheEntry<T> = { fetchedAt: Date.now(), data };
    writeFileSync(path, JSON.stringify(entry), "utf-8");
  } catch {
    // Cache writes are opportunistic. A read-only home directory or sandboxed
    // environment should not make the registry appear unreachable.
  }
}

// ── Fetchers ────────────────────────────────────────────────────────────────

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) {
    throw new Error(`Registry fetch failed: ${url} — HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

/**
 * Fetch the top-level registry.json manifest. Served from cache while fresh,
 * revalidated after 24h, and — when revalidation fails — served stale rather
 * than not at all. Returns undefined only when the registry is unreachable AND
 * nothing was ever cached.
 *
 * `skipCache` forces revalidation; it does not forbid the stale fallback,
 * because "check for something newer" and "rather have nothing than this" are
 * different requests and only the first one is ever made.
 */
export async function fetchRegistryManifest(
  baseUrl: string = DEFAULT_REGISTRY_URL,
  options?: { skipCache?: boolean },
): Promise<RegistryManifest | undefined> {
  const cacheFile = cachePath(baseUrl, "registry");
  const cached = readCacheEntry<RegistryManifest>(cacheFile);
  if (!options?.skipCache && cached && isFresh(cached)) return cached.data;

  try {
    const manifest = await fetchJson<RegistryManifest>(`${baseUrl}/registry.json`);
    writeCache(cacheFile, manifest);
    return manifest;
  } catch {
    return cached?.data;
  }
}

/**
 * Fetch a single item's `registry-item.json` manifest. Same freshness policy as
 * the top-level manifest: fresh from cache, else revalidate, else serve stale.
 * Throws on network failure only when nothing was ever cached for this item
 * (callers decide whether to degrade gracefully).
 */
export async function fetchItemManifest(
  name: string,
  type: ItemType,
  baseUrl: string = DEFAULT_REGISTRY_URL,
): Promise<RegistryItem> {
  const dir = ITEM_TYPE_DIRS[type];
  const cacheFile = cachePath(baseUrl, `${dir}__${name}`);
  const cached = readCacheEntry<RegistryItem>(cacheFile);
  if (cached && isFresh(cached)) return cached.data;

  const url = `${baseUrl}/${dir}/${name}/registry-item.json`;
  try {
    const item = await fetchJson<RegistryItem>(url);
    writeCache(cacheFile, item);
    return item;
  } catch (err) {
    if (cached) return cached.data;
    throw err;
  }
}

/**
 * Download a single file referenced by an item to a local destination.
 * Caller is responsible for target-path validation (see installer.ts).
 */
export async function fetchItemFile(
  item: RegistryItem,
  file: FileTarget,
  destPath: string,
  baseUrl: string = DEFAULT_REGISTRY_URL,
): Promise<void> {
  // Reject path-traversal in file.path (mirrors assertSafeTarget for file.target).
  if (/(^|[/\\])\.\.([/\\]|$)/.test(file.path)) {
    throw new Error(`Unsafe file.path "${file.path}": path segments may not contain "..".`);
  }
  const url = `${baseUrl}/${ITEM_TYPE_DIRS[item.type]}/${item.name}/${file.path}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) {
    throw new Error(`File fetch failed: ${url} — HTTP ${res.status}`);
  }
  const buf = new Uint8Array(await res.arrayBuffer());
  mkdirSync(dirname(destPath), { recursive: true });
  writeFileSync(destPath, buf);
}
