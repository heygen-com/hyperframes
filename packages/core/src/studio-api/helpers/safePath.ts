import { resolve, sep, join, dirname, basename } from "node:path";
import { readdirSync, realpathSync } from "node:fs";

/**
 * Reject paths that escape the project directory — including via symlinks.
 *
 * `path.resolve()` collapses `.`/`..` but does NOT dereference symlinks, so a
 * plain prefix check (`resolved.startsWith(base + sep)`) can be defeated by a
 * symlink that lives *inside* the project dir but points outside it (e.g.
 * `project/link -> /etc`). A downstream `readFileSync`/`writeFileSync`/`statSync`
 * then follows that link to a file outside `base`. To close this we canonicalize
 * both sides with `realpathSync` before comparing.
 *
 * The target may not exist yet (e.g. creating a new file), so we canonicalize the
 * deepest *existing* ancestor and re-attach the trailing not-yet-existing
 * segments. Segments that don't exist cannot be symlinks at check time, so they
 * can't redirect the path outside `base` right now. (A symlink swapped in between
 * this check and the subsequent fs call is an inherent TOCTOU race this helper
 * does not, and cannot by itself, defend against.)
 */
export function isSafePath(base: string, resolved: string): boolean {
  let baseReal: string;
  try {
    baseReal = realpathSync(resolve(base));
  } catch {
    // Base must exist and be resolvable; fail closed if not.
    return false;
  }

  const target = resolve(resolved);
  const trailing: string[] = [];
  let probe = target;

  for (;;) {
    let ancestorReal: string;
    try {
      ancestorReal = realpathSync(probe);
    } catch {
      const parent = dirname(probe);
      if (parent === probe) return false; // walked past the filesystem root
      trailing.push(basename(probe));
      probe = parent;
      continue;
    }

    const targetReal = trailing.length ? join(ancestorReal, ...trailing.reverse()) : ancestorReal;
    return targetReal === baseReal || targetReal.startsWith(baseReal + sep);
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
