import { readBoundedRegistryFile } from "./boundedFile.js";
import { publishRegistryFile, registryRoot } from "./publication.js";
import { fetchRegistryHttps, registryHttpsUrl, registryPathUrl } from "./transport.js";
import { readBoundedResponse, type DownloadByteBudget } from "../capture/readBoundedResponse.js";
import { validRegistryName, validRegistryManifest, validRegistryItem } from "./validation.js";
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

import { join, basename } from "node:path";
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
const MAX_MANIFEST_BYTES = 10 * 1024 * 1024;

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
function readCacheEntry<T>(
  path: string,
  validate: (value: unknown) => value is T,
): CacheEntry<T> | undefined {
  try {
    const entry = JSON.parse(
      readBoundedRegistryFile(path, MAX_MANIFEST_BYTES).toString("utf8"),
    ) as CacheEntry<unknown>;
    if (!entry || typeof entry.fetchedAt !== "number" || !Number.isFinite(entry.fetchedAt))
      return undefined;
    // The callers now test the entry rather than the payload, so an empty
    // payload would satisfy them: `null` data would short-circuit the fetch
    // and be handed back as a RegistryItem. Rejecting it here keeps the miss
    // failing toward "go ask the network" rather than toward "the catalog is
    // empty", which is the whole point of the change around it.
    if (!validate(entry.data)) return undefined;
    return { fetchedAt: entry.fetchedAt, data: entry.data };
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
    const root = registryRoot(CACHE_DIR);
    const entry: CacheEntry<T> = { fetchedAt: Date.now(), data };
    publishRegistryFile(root, basename(path), JSON.stringify(entry));
  } catch {
    // Cache writes are opportunistic. A read-only home directory or sandboxed
    // environment should not make the registry appear unreachable.
  }
}

// ── Fetchers ────────────────────────────────────────────────────────────────

async function fetchJson<T>(url: string, validate: (value: unknown) => value is T): Promise<T> {
  const res = await fetchRegistryHttps(url, AbortSignal.timeout(FETCH_TIMEOUT_MS));
  if (!res.ok) {
    throw new Error(`Registry fetch failed: ${url} — HTTP ${res.status}`);
  }
  const bytes = await readBoundedResponse(res, MAX_MANIFEST_BYTES);
  if (!bytes) throw new Error("Registry manifest exceeds download limit");
  const data: unknown = JSON.parse(bytes.toString("utf8"));
  if (!validate(data)) throw new Error("Invalid registry manifest");
  return data;
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
  const url = registryPathUrl(baseUrl, "registry.json");
  const cacheFile = cachePath(baseUrl, "registry");
  const cached = readCacheEntry(cacheFile, validRegistryManifest);
  if (!options?.skipCache && cached && isFresh(cached)) return cached.data;

  try {
    const manifest = await fetchJson(url, validRegistryManifest);
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
  if (!validRegistryName(name) || !Object.hasOwn(ITEM_TYPE_DIRS, type))
    throw new Error("Invalid registry item name or type");
  const dir = ITEM_TYPE_DIRS[type];
  const validate = (value: unknown): value is RegistryItem => validRegistryItem(value, name, type);
  const url = registryPathUrl(baseUrl, dir, name, "registry-item.json");
  const cacheFile = cachePath(baseUrl, `${dir}__${name}`);
  const cached = readCacheEntry(cacheFile, validate);
  if (cached && isFresh(cached)) return cached.data;

  try {
    const item = await fetchJson(url, validate);
    writeCache(cacheFile, item);
    return item;
  } catch (err) {
    if (cached) return cached.data;
    throw err;
  }
}

/**
 * Flatten an error and its `cause` chain into one readable line.
 *
 * `fetch failed` on its own is useless. `fetch failed (self-signed certificate
 * in certificate chain)` tells the reader exactly which knob to turn, and that
 * string only exists one or two levels down the chain.
 */
export function describeCauseChain(err: unknown): string {
  const parts: string[] = [];
  let current: unknown = err;
  const seen = new Set<unknown>();
  while (current instanceof Error && !seen.has(current)) {
    seen.add(current);
    const code = (current as { code?: unknown }).code;
    const text =
      code && !current.message.includes(String(code))
        ? `${current.message} [${String(code)}]`
        : current.message;
    if (text && !parts.includes(text)) parts.push(text);
    current = current.cause;
  }
  if (parts.length === 0) return String(err);
  const [head, ...rest] = parts;
  return rest.length ? `${head} (${rest.join("; ")})` : head!;
}

/**
 * A transient failure worth trying again, as opposed to a settled answer.
 *
 * A refused connection, a reset socket or a DNS hiccup usually clears on the
 * next attempt. A TLS failure does not: a self-signed certificate on a private
 * registry fails identically every time, and retrying it only makes the user
 * wait three times as long for the same message.
 */
function isRetryableTransport(err: unknown): boolean {
  const text = describeCauseChain(err).toLowerCase();
  if (/certificate|self-signed|self signed|unable to verify|altname|ssl|tls/.test(text)) {
    return false;
  }
  return /fetch failed|econnreset|econnrefused|etimedout|eai_again|socket hang up|timeouterror|aborted|network/.test(
    text,
  );
}

/**
 * Item files are the one uncached path: manifests fall back to a stale copy,
 * but every install downloads its files fresh. That made a single blip fatal to
 * the whole command, which is a bad trade for two extra attempts costing under
 * a second when the network is healthy.
 */
async function fetchWithRetry(url: string, attempts = 3): Promise<Response> {
  let lastErr: unknown;
  const signal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fetchRegistryHttps(url, signal);
    } catch (err) {
      lastErr = err;
      if (attempt === attempts || !isRetryableTransport(err)) break;
      // Short, bounded backoff. Long enough to clear a blip, short enough that
      // a genuinely offline machine still fails promptly.
      await new Promise((resolve) => setTimeout(resolve, 150 * attempt));
    }
  }
  throw lastErr;
}

/**
 * Where a file's bytes actually live.
 *
 * Most files sit beside their manifest in the registry, so the URL is the base
 * plus the item's directory plus `file.path`. A file that declares `url` is
 * hosted elsewhere — binary assets go to a CDN so the registry stays text-only
 * — and is fetched from there verbatim.
 *
 * Only `https://` is honoured. Anything else (`http://`, `file://`, a bare
 * hostname) is a mistake in a manifest a user did not write, and silently
 * treating it as a relative path would produce a nonsense URL and a 404 no one
 * can read, so it is rejected where the manifest is at fault.
 */
export function assetSourceUrl(
  item: RegistryItem,
  file: FileTarget,
  baseUrl: string = DEFAULT_REGISTRY_URL,
): string {
  if (file.url === undefined) {
    return registryPathUrl(baseUrl, ITEM_TYPE_DIRS[item.type], item.name, file.path);
  }
  if (!file.url.startsWith("https://")) {
    throw new Error(
      `Unsafe file.url "${file.url}" for "${item.name}/${file.path}": must be an absolute https:// URL.`,
    );
  }
  return registryHttpsUrl(file.url).href;
}

/**
 * Read bounded item bytes; the installer owns transforms and safe publication.
 */
export async function fetchItemFile(
  item: RegistryItem,
  file: FileTarget,
  baseUrl: string = DEFAULT_REGISTRY_URL,
  budget: DownloadByteBudget = { remainingBytes: 512 * 1024 * 1024 },
): Promise<Buffer> {
  // Reject path-traversal in file.path (mirrors assertSafeTarget for file.target).
  if (/(^|[/\\])\.\.([/\\]|$)/.test(file.path)) {
    throw new Error(`Unsafe file.path "${file.path}": path segments may not contain "..".`);
  }
  const url = assetSourceUrl(item, file, baseUrl);
  let res: Response;
  try {
    res = await fetchWithRetry(url);
  } catch (err) {
    // undici throws a bare "fetch failed" and buries the real reason in
    // `cause`, sometimes a level deeper again. That is where the diagnosis
    // lives: a self-signed certificate on a private registry, a DNS failure, a
    // refused connection. Without it the message is two words that describe
    // every possible network problem equally badly.
    throw new Error(`File fetch failed: ${url} — ${describeCauseChain(err)}`, { cause: err });
  }
  if (!res.ok) {
    throw new Error(`File fetch failed: ${url} — HTTP ${res.status}`);
  }
  const bytes = await readBoundedResponse(res, 128 * 1024 * 1024, budget);
  if (!bytes) throw new Error("Registry file exceeds download budget");
  return bytes;
}
