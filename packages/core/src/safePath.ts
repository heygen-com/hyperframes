import { resolve, sep, join, dirname, basename } from "node:path";
import { realpathSync } from "node:fs";

/**
 * Reject paths that escape the `base` directory — including via symlinks.
 *
 * `path.resolve()` collapses `.`/`..` but does NOT dereference symlinks, so a
 * plain prefix check (`resolved.startsWith(base + sep)`) can be defeated by a
 * symlink that lives *inside* `base` but points outside it (e.g.
 * `base/link -> /etc`). A downstream `readFileSync`/`writeFileSync`/`statSync`
 * then follows that link to a file outside `base`. To close this we canonicalize
 * both sides with `realpathSync` before comparing.
 *
 * The target may not exist yet (e.g. creating a new file), so we canonicalize the
 * deepest *existing* ancestor and re-attach the trailing not-yet-existing
 * segments. Segments that don't exist cannot be symlinks at check time, so they
 * can't redirect the path outside `base` right now. (A symlink swapped in between
 * this check and the subsequent fs call is an inherent TOCTOU race this helper
 * does not, and cannot by itself, defend against.)
 *
 * Lives at the package root rather than under `studio-api/` because callers span
 * layers — `studio-api` routes, the `compiler`, the CLI, and the engine — and
 * `compiler` sits below `studio-api` in the dependency graph, so it cannot import
 * from there without a backwards edge.
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

    // Copy before reverse(): the array is only consumed once today, but a future
    // edit that loops would otherwise silently misorder the rebuilt segments.
    const targetReal = trailing.length
      ? join(ancestorReal, ...[...trailing].reverse())
      : ancestorReal;
    return targetReal === baseReal || targetReal.startsWith(baseReal + sep);
  }
}

/**
 * Resolve `relativePath` against `base` and return the absolute path only if it
 * stays within `base` (after symlink resolution); otherwise return `null`.
 *
 * Prefer this over a bare `resolve()` followed by a separate `isSafePath()`
 * check: collapsing the two into one call means a caller cannot resolve a
 * project-relative path and then forget the containment guard — the gap that
 * let the symlink-escape slip past several call sites historically.
 */
export function resolveWithinProject(base: string, relativePath: string): string | null {
  const resolved = resolve(base, relativePath);
  return isSafePath(base, resolved) ? resolved : null;
}
