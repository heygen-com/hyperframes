// Compat shim — the registry resolver (packages/cli/src/registry/) is the
// canonical implementation. Kept so init.ts and any external imports that
// reference this path keep working. Converts new RegistryItem manifests back
// into the TemplateOption shape the init wizard still uses. Deletable once
// init.ts is fully ported to call the resolver directly.

import { listRegistryItems, loadAllItems } from "../registry/index.js";

export type TemplateSource = "bundled" | "remote";

export interface TemplateOption {
  id: string;
  label: string;
  hint: string;
  source: TemplateSource;
}

/** Templates bundled in the CLI package (available offline). */
export const BUNDLED_TEMPLATES: TemplateOption[] = [
  {
    id: "blank",
    label: "Blank",
    hint: "Centered Inter stage, paused timeline",
    source: "bundled",
  },
];

/**
 * Resolve the full template list by merging bundled templates with remote
 * examples fetched from the registry. Offline / unreachable → bundled only.
 */
export async function resolveTemplateList(): Promise<TemplateOption[]> {
  const bundled = [...BUNDLED_TEMPLATES];
  const bundledIds = new Set(bundled.map((t) => t.id));

  const entries = await listRegistryItems({ type: "hyperframes:example" });
  const items = await loadAllItems(entries);

  const remoteOptions: TemplateOption[] = items
    .filter((item) => !bundledIds.has(item.name))
    .map((item) => ({
      id: item.name,
      label: item.title,
      hint: item.description,
      source: "remote" as const,
    }));

  return [...bundled, ...remoteOptions];
}
