import { listRemoteTemplates, type RemoteTemplateInfo } from "./remote.js";

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
    hint: "Empty composition — just the scaffolding",
    source: "bundled",
  },
];

/**
 * Resolve the full template list by merging bundled and remote templates.
 * Fetches templates.json from GitHub (cached 24h). No CLI release needed to add templates.
 * If offline, returns only bundled templates.
 */
export async function resolveTemplateList(): Promise<TemplateOption[]> {
  const bundled = [...BUNDLED_TEMPLATES];
  const bundledIds = new Set(bundled.map((t) => t.id));

  let remote: RemoteTemplateInfo[] = [];
  try {
    remote = await listRemoteTemplates();
  } catch {
    // Offline — return bundled only
  }

  const remoteOptions: TemplateOption[] = remote
    .filter((r) => !r.bundled && !bundledIds.has(r.id))
    .map((r) => ({
      id: r.id,
      label: r.label,
      hint: r.hint,
      source: "remote" as const,
    }));

  return [...bundled, ...remoteOptions];
}
