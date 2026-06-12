// Compat shim — fetchRemoteTemplate delegates to the registry resolver +
// installer (packages/cli/src/registry/). Kept so init.ts and external imports
// that reference this path keep working. Deletable once init.ts is fully
// ported to call the resolver directly.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { installItem, listRegistryItems, loadAllItems } from "../registry/index.js";
import { resolveItemWithDependencies } from "../registry/resolver.js";
import { gateRegistryItemsCompatibility } from "../registry/compatibility.js";

// Re-exported for the existing remote.test.ts regression guard. These paths
// describe the repo layout under the default registry URL; updating them in
// sync with any future move prevents silent breakage of installed CLIs.
export const TEMPLATES_DIR = "registry/examples";
export const MANIFEST_FILENAME = "templates.json";

export interface RemoteTemplateInfo {
  id: string;
  label: string;
  hint: string;
  bundled: boolean;
}

/**
 * List available remote templates — kept for backwards compat with external
 * imports. Internally, `resolveTemplateList` in generators.ts is what init.ts
 * uses, and it goes through the registry resolver directly.
 */
export async function listRemoteTemplates(): Promise<RemoteTemplateInfo[]> {
  const entries = await listRegistryItems({ type: "hyperframes:example" });
  const items = await loadAllItems(entries);
  return items.map((item) => ({
    id: item.name,
    label: item.title,
    hint: item.description,
    bundled: false,
  }));
}

/**
 * Download a template into destDir. Delegates to the registry installer.
 *
 * Resolves the template's transitive `registryDependencies` and installs them
 * before the template itself, so a template that depends on other registry
 * items gets a complete install rather than silently dropping its deps.
 *
 * Every resolved item is compatibility-gated up front (same gate as
 * `hyperframes add`), so an incompatible template — or any of its deps —
 * aborts before a single file is written.
 */
export async function fetchRemoteTemplate(templateId: string, destDir: string): Promise<void> {
  const items = await resolveItemWithDependencies(templateId);
  const warnings = gateRegistryItemsCompatibility(items);
  for (const warning of warnings) {
    process.stderr.write(`hyperframes:registry ${warning}\n`);
  }
  for (const item of items) {
    await installItem(item, { destDir });
  }

  // Safety check — an item with no index.html isn't a valid example.
  if (!existsSync(join(destDir, "index.html"))) {
    throw new Error(
      `Example "${templateId}" installed but missing index.html. The registry item may be malformed.`,
    );
  }
}
