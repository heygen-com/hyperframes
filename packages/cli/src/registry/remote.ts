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

function readCache<T>(path: string): T | undefined {
  try {
    const entry = JSON.parse(readFileSync(path, "utf-8")) as CacheEntry<T>;
    if (typeof entry.fetchedAt !== "number") return undefined;
    if (Date.now() - entry.fetchedAt > CACHE_TTL_MS) return undefined;
    return entry.data;
  } catch {
    // Missing file or corrupt JSON → cache miss.
    return undefined;
  }
}

function writeCache<T>(path: string, data: T): void {
  mkdirSync(dirname(path), { recursive: true });
  const entry: CacheEntry<T> = { fetchedAt: Date.now(), data };
  writeFileSync(path, JSON.stringify(entry), "utf-8");
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
 * Fetch the top-level registry.json manifest. Cached for 24h.
 * Returns undefined if the registry is unreachable (offline / 404).
 */
export async function fetchRegistryManifest(
  baseUrl: string = DEFAULT_REGISTRY_URL,
): Promise<RegistryManifest | undefined> {
  const cacheFile = cachePath(baseUrl, "registry");
  const cached = readCache<RegistryManifest>(cacheFile);
  if (cached) return cached;

  try {
    const manifest = await fetchJson<RegistryManifest>(`${baseUrl}/registry.json`);
    writeCache(cacheFile, manifest);
    return manifest;
  } catch {
    return undefined;
  }
}

/**
 * Fetch a single item's `registry-item.json` manifest. Cached for 24h.
 * Throws on network failure (callers decide whether to degrade gracefully).
 */
export async function fetchItemManifest(
  name: string,
  type: ItemType,
  baseUrl: string = DEFAULT_REGISTRY_URL,
): Promise<RegistryItem> {
  const dir = ITEM_TYPE_DIRS[type];
  const cacheFile = cachePath(baseUrl, `${dir}__${name}`);
  const cached = readCache<RegistryItem>(cacheFile);
  if (cached) return cached;

  const url = `${baseUrl}/${dir}/${name}/registry-item.json`;
  const item = await fetchJson<RegistryItem>(url);
  writeCache(cacheFile, item);
  return item;
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
