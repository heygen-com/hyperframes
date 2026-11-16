import { statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";

const userCacheRoot = () => join(homedir(), ".cache", "hyperframes");

export function hyperframesCacheDir(...parts: string[]): string {
  const named = process.env["HYPERFRAMES_CACHE_DIR"];
  return join(named ? resolve(named) : userCacheRoot(), ...parts);
}

export function namedCacheDir(...parts: string[]): string | undefined {
  return process.env["HYPERFRAMES_CACHE_DIR"] ? hyperframesCacheDir(...parts) : undefined;
}

/**
 * The first of `path` and its folders up to `root` (or, while `root` does not exist yet, the nearest
 * folder above it) that another account could have written: owned by neither this user nor root, or
 * group- or world-writable. Undefined when there is none, and always on Windows, which has no uid.
 */
export function foreignWritablePath(path: string, root: string): string | undefined {
  const uid = process.getuid?.();
  if (uid === undefined) return undefined;
  const top = resolve(root);
  for (let at = resolve(path); ; at = dirname(at)) {
    const stat = statSync(at, { throwIfNoEntry: false });
    if (stat && ((stat.uid !== uid && stat.uid !== 0) || (stat.mode & 0o022) !== 0)) return at;
    const pastRoot = at === top || !at.startsWith(top + sep);
    if ((stat && pastRoot) || at === dirname(at)) return undefined;
  }
}

/**
 * The cache root for the browsers, packages and helpers this account runs: HYPERFRAMES_CACHE_DIR, or
 * this user's own cache when another account can write that folder.
 */
export function trustedCacheRoot(): string {
  const root = hyperframesCacheDir();
  return foreignWritablePath(root, root) ? userCacheRoot() : root;
}
