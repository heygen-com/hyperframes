// Compat shim — fetchRemoteTemplate delegates to the registry resolver +
// installer (packages/cli/src/registry/). Kept so init.ts and external imports
// that reference this path keep working. Deletable once init.ts is fully
// ported to call the resolver directly.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { installItem, listRegistryItems, loadAllItems, resolveItem } from "../registry/index.js";

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
 */
export async function fetchRemoteTemplate(templateId: string, destDir: string): Promise<void> {
  const item = await resolveItem(templateId);
  await installItem(item, { destDir });

  // Safety check — an item with no index.html isn't a valid example.
  if (!existsSync(join(destDir, "index.html"))) {
    throw new Error(
      `Example "${templateId}" installed but missing index.html. The registry item may be malformed.`,
    );
  }
}
