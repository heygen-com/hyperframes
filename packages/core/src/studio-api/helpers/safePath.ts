import { resolve, sep, join, dirname, basename } from "node:path";
import { readdirSync, realpathSync } from "node:fs";

/** Reject paths that escape the project directory. */
export function isSafePath(base: string, resolved: string): boolean {
  try {
    const baseReal = realpathSync(resolve(base));
    const target = resolve(resolved);
    let probe = target;
    const segments: string[] = [];
    let targetReal: string;

    while (true) {
      try {
        const real = realpathSync(probe);
        targetReal = segments.length ? join(real, ...segments.reverse()) : real;
        break;
      } catch {
        const parent = dirname(probe);
        if (parent === probe) return false;
        segments.push(basename(probe));
        probe = parent;
      }
    }

    const norm = baseReal + sep;
    return targetReal.startsWith(norm) || targetReal === baseReal;
  } catch {
    return false;
  }
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
