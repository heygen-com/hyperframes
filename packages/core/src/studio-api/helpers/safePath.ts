import { join } from "node:path";
import { readdirSync } from "node:fs";

// `isSafePath` lives at the package root so non-studio-api layers (compiler,
// CLI, engine) can share it without a backwards dependency on studio-api.
// Re-exported here for back-compat with existing `../helpers/safePath.js` imports.
export { isSafePath } from "../../safePath.js";

const IGNORE_DIRS = new Set([".thumbnails", "node_modules", ".git"]);

/** Recursively walk a directory and return relative file paths. */
export function walkDir(dir: string, prefix = ""): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (IGNORE_DIRS.has(entry.name)) continue;
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...walkDir(join(dir, entry.name), rel));
    } else {
      files.push(rel);
    }
  }
  return files;
}
