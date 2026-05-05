/**
 * Registry resolver — loads the top-level manifest and per-item manifests.
 * Supports transitive `registryDependencies` resolution for install flows.
 */

import type { ItemType, RegistryItem, RegistryManifestEntry } from "@hyperframes/core";
import { fetchItemManifest, fetchRegistryManifest, DEFAULT_REGISTRY_URL } from "./remote.js";

export interface ResolveOptions {
  baseUrl?: string;
  /**
   * Called once per item that fails to load inside `loadAllItems`. Defaults
   * to writing a diagnostic line to stderr. Pass a quieter implementation
   * when rendering structured output (clack prompts, JSON, etc.).
   */
  onWarn?: (message: string) => void;
}

function defaultWarn(message: string): void {
  process.stderr.write(`hyperframes:registry ${message}\n`);
}

/**
 * List all items in the registry, optionally filtered by type. Returns empty
 * if the registry is unreachable — callers should fall back to bundled items.
 */
export async function listRegistryItems(
  filter?: { type?: ItemType },
  options: ResolveOptions = {},
): Promise<RegistryManifestEntry[]> {
  const baseUrl = options.baseUrl ?? DEFAULT_REGISTRY_URL;
  const manifest = await fetchRegistryManifest(baseUrl);
  if (!manifest) return [];
  if (!filter?.type) return manifest.items;
  return manifest.items.filter((item) => item.type === filter.type);
}

/**
 * Load every item's full manifest in parallel. Used by the interactive init
 * picker to populate titles/descriptions for all examples at once. Items that
 * fail to load are skipped with a warning so one missing manifest doesn't
 * break the picker.
 */
export async function loadAllItems(
  entries: RegistryManifestEntry[],
  options: ResolveOptions = {},
): Promise<RegistryItem[]> {
  const baseUrl = options.baseUrl ?? DEFAULT_REGISTRY_URL;
  const warn = options.onWarn ?? defaultWarn;
  const results = await Promise.allSettled(
    entries.map((e) => fetchItemManifest(e.name, e.type, baseUrl)),
  );
  const items: RegistryItem[] = [];
  results.forEach((r, i) => {
    if (r.status === "fulfilled") {
      items.push(r.value);
    } else {
      const name = entries[i]?.name ?? "<unknown>";
      warn(`skipped item "${name}": ${String(r.reason)}`);
    }
  });
  return items;
}

function formatAvailable(entries: RegistryManifestEntry[]): string {
  return entries.map((e) => e.name).join(", ");
}

/**
 * Resolve a single item by name. Throws if unknown or unreachable.
 */
export async function resolveItem(
  name: string,
  options: ResolveOptions = {},
): Promise<RegistryItem> {
  const items = await resolveItemWithDependencies(name, options);
  const item = items[items.length - 1];
  if (!item) {
    throw new Error(`Item "${name}" not found — registry unreachable or empty.`);
  }
  return item;
}

/**
 * Resolve one item and all of its transitive `registryDependencies` in
 * topological order (dependencies first, requested item last).
 */
export async function resolveItemWithDependencies(
  name: string,
  options: ResolveOptions = {},
): Promise<RegistryItem[]> {
  const entries = await listRegistryItems(undefined, options);
  const entry = entries.find((e) => e.name === name);
  if (!entry) {
    const available = formatAvailable(entries);
    throw new Error(
      available.length > 0
        ? `Item "${name}" not found in registry. Available: ${available}`
        : `Item "${name}" not found — registry unreachable or empty.`,
    );
  }

  const entryByName = new Map(entries.map((e) => [e.name, e]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const ordered: RegistryItem[] = [];
  const itemCache = new Map<string, Promise<RegistryItem>>();

  const getItem = (itemName: string): Promise<RegistryItem> => {
    const existing = itemCache.get(itemName);
    if (existing) return existing;

    const registryEntry = entryByName.get(itemName);
    if (!registryEntry) {
      const available = formatAvailable(entries);
      throw new Error(
        available.length > 0
          ? `Dependency "${itemName}" not found in registry. Available: ${available}`
          : `Dependency "${itemName}" not found — registry unreachable or empty.`,
      );
    }

    const pending = fetchItemManifest(registryEntry.name, registryEntry.type, options.baseUrl);
    itemCache.set(itemName, pending);
    return pending;
  };

  const visit = async (itemName: string, path: string[]): Promise<void> => {
    if (visited.has(itemName)) return;
    if (visiting.has(itemName)) {
      const cycleStart = path.indexOf(itemName);
      const cyclePath = [...path.slice(cycleStart), itemName].join(" -> ");
      throw new Error(`Circular registryDependencies detected: ${cyclePath}`);
    }

    visiting.add(itemName);
    const item = await getItem(itemName);
    for (const dep of item.registryDependencies ?? []) {
      await visit(dep, [...path, itemName]);
    }
    visiting.delete(itemName);
    visited.add(itemName);
    ordered.push(item);
  };

  await visit(name, []);
  return ordered;
}
