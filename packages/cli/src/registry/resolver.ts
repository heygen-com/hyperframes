/**
 * Registry resolver — loads the top-level manifest and per-item manifests.
 * No transitive dependency resolution yet (examples don't have any); added
 * when blocks/components need it for the `add` command.
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

/**
 * Resolve a single item by name. Throws if unknown or unreachable.
 *
 * TODO: walk registryDependencies transitively and return a topo-sorted
 * list of items. Today examples have no deps so this returns a single item.
 * Blocks and components will need transitive resolution once they ship with
 * deps (seed items in Phase B).
 */
export async function resolveItem(
  name: string,
  options: ResolveOptions = {},
): Promise<RegistryItem> {
  const entries = await listRegistryItems(undefined, options);
  const entry = entries.find((e) => e.name === name);
  if (!entry) {
    const available = entries.map((e) => e.name).join(", ");
    throw new Error(
      available.length > 0
        ? `Item "${name}" not found in registry. Available: ${available}`
        : `Item "${name}" not found — registry unreachable or empty.`,
    );
  }
  return fetchItemManifest(entry.name, entry.type, options.baseUrl);
}
