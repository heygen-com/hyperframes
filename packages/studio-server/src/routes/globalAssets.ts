import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Hono } from "hono";

// Non-project-scoped route: the media-use global asset cache (~/.media). Lets the
// Studio Asset tab show assets resolved in OTHER projects (cross-project reuse).
// Reads ONLY the global manifest — no path params, no arbitrary fs access.

export interface GlobalAssetRecord {
  id?: string;
  type?: string;
  description?: string;
  sha?: string;
  cached_path?: string;
  entity?: string;
}

/** Parse the global manifest (~/.media/manifest.jsonl) into reusable records. */
export function readGlobalAssets(home = homedir()): GlobalAssetRecord[] {
  const manifestPath = join(home, ".media", "manifest.jsonl");
  if (!existsSync(manifestPath)) return [];
  const out: GlobalAssetRecord[] = [];
  for (const line of readFileSync(manifestPath, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const rec = JSON.parse(line);
      if (rec && rec.reusable) out.push(rec);
    } catch {
      // skip malformed lines — a torn write shouldn't 500 the panel
    }
  }
  return out;
}

// Fields the Studio panel actually renders. Deliberately omits cached_path —
// an absolute ~/.media filesystem path has no business reaching the browser (m13).
export function toPublicAsset(r: GlobalAssetRecord): GlobalAssetRecord {
  return { id: r.id, type: r.type, description: r.description, sha: r.sha, entity: r.entity };
}

export function registerGlobalAssetRoutes(api: Hono): void {
  api.get("/assets/global", (c) => c.json({ assets: readGlobalAssets().map(toPublicAsset) }));
}
