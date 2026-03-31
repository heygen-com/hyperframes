/**
 * Remote Template Fetching
 *
 * Downloads templates from the hyperframes GitHub repository using giget.
 * Templates live in the `templates/` directory of the repo.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const REPO = "heygen-com/hyperframes";
const TEMPLATES_DIR = "templates";
const MANIFEST_FILENAME = "templates.json";

/** Cache directory for remote template metadata. */
const CACHE_DIR = join(homedir(), ".hyperframes", "cache");
const MANIFEST_CACHE_PATH = join(CACHE_DIR, "remote-templates.json");
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface RemoteTemplateInfo {
  id: string;
  label: string;
  hint: string;
  bundled: boolean;
}

interface ManifestCache {
  fetchedAt: number;
  templates: RemoteTemplateInfo[];
}

/**
 * Fetch the remote template manifest from GitHub.
 * Caches the result for 24 hours to avoid rate limits.
 */
export async function listRemoteTemplates(): Promise<RemoteTemplateInfo[]> {
  // Check cache first
  if (existsSync(MANIFEST_CACHE_PATH)) {
    try {
      const cached: ManifestCache = JSON.parse(readFileSync(MANIFEST_CACHE_PATH, "utf-8"));
      if (Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
        return cached.templates;
      }
    } catch {
      // Cache corrupt — refetch
    }
  }

  // Fetch from GitHub raw content
  const url = `https://raw.githubusercontent.com/${REPO}/main/${TEMPLATES_DIR}/${MANIFEST_FILENAME}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5_000) });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const data = (await res.json()) as { templates: RemoteTemplateInfo[] };
    const templates = data.templates;

    // Write cache
    mkdirSync(CACHE_DIR, { recursive: true });
    const cache: ManifestCache = { fetchedAt: Date.now(), templates };
    writeFileSync(MANIFEST_CACHE_PATH, JSON.stringify(cache), "utf-8");

    return templates;
  } catch {
    // Offline or rate-limited — return empty (caller should fall back to bundled)
    return [];
  }
}

/**
 * Download a template from GitHub into destDir using giget.
 * Fetches from `examples/<templateId>` in the hyperframes repo.
 */
export async function fetchRemoteTemplate(
  templateId: string,
  destDir: string,
  options?: { ref?: string },
): Promise<void> {
  // Validate against manifest before downloading
  const known = await listRemoteTemplates();
  if (known.length > 0 && !known.some((t) => t.id === templateId)) {
    const available = known.map((t) => t.id).join(", ");
    throw new Error(`Template "${templateId}" not found. Available: ${available}`);
  }

  const { downloadTemplate } = await import("giget");
  const ref = options?.ref ?? "main";
  const source = `github:${REPO}/${TEMPLATES_DIR}/${templateId}#${ref}`;

  await downloadTemplate(source, {
    dir: destDir,
    force: true,
  });

  // Safety check — giget can succeed with empty dir if path doesn't exist
  if (!existsSync(join(destDir, "index.html"))) {
    throw new Error(
      `Template "${templateId}" downloaded but missing index.html. The template may be malformed.`,
    );
  }
}
