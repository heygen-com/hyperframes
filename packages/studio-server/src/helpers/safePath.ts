import { join } from "node:path";
import { readdirSync } from "node:fs";

// `isSafePath` lives at the package root so non-studio-api layers (compiler,
// CLI, engine) can share it without a backwards dependency on studio-api.
// Re-exported here for back-compat with existing `../helpers/safePath.js` imports.
export { isSafePath, resolveWithinProject } from "@hyperframes/core";

const IGNORE_DIRS = new Set([".thumbnails", "node_modules", ".git"]);

function shouldIgnoreDir(rel: string): boolean {
  return rel === ".hyperframes/backup";
}

/**
 * True when any directory segment of a relative path is a dot-directory or
 * node_modules. Projects that vendor tooling assets under dot-directories
 * (.hyperframes/, .cache/, …) ship example/preset HTML that must not surface
 * as project compositions or studio lint targets (#1384). The file tree is
 * deliberately not filtered — this only gates discovery.
 */
export function isInHiddenOrVendorDir(relPath: string): boolean {
  const segments = relPath.split("/");
  return segments.slice(0, -1).some((seg) => seg.startsWith(".") || seg === "node_modules");
}

/** Recursively walk a directory and return relative file paths. */
export function walkDir(dir: string, prefix = ""): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (IGNORE_DIRS.has(entry.name) || shouldIgnoreDir(rel)) continue;
    if (entry.isDirectory()) {
      files.push(...walkDir(join(dir, entry.name), rel));
    } else {
      files.push(rel);
    }
  }
  return files;
}
