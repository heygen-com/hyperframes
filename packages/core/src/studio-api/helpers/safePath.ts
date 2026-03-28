import { resolve, sep, join } from "node:path";
import { readdirSync } from "node:fs";

/** Reject paths that escape the project directory. */
export function isSafePath(base: string, resolved: string): boolean {
  const norm = resolve(base) + sep;
  return resolved.startsWith(norm) || resolved === resolve(base);
}

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
