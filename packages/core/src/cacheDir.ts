import { chmodSync, lstatSync, readdirSync, statSync } from "node:fs";
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

/**
 * Takes group and world write off what this account just installed at `path`, and off the folders it
 * sits in up to `root`, so that a umask such as 002 does not leave the install looking like another
 * account could have written it. Symlinks and what other accounts own are left alone.
 */
export function sealCacheInstall(path: string, root: string): void {
  const uid = process.getuid?.();
  if (uid === undefined) return;
  const seal = (at: string) => {
    const stat = lstatSync(at, { throwIfNoEntry: false });
    if (!stat || stat.isSymbolicLink() || stat.uid !== uid) return;
    if ((stat.mode & 0o022) !== 0) chmodSync(at, stat.mode & 0o7755);
    if (stat.isDirectory()) for (const name of readdirSync(at)) seal(join(at, name));
  };
  seal(resolve(path));
  const top = resolve(root);
  for (let at = dirname(resolve(path)); at === top || at.startsWith(top + sep); at = dirname(at)) {
    const stat = statSync(at, { throwIfNoEntry: false });
    if (stat?.uid === uid && (stat.mode & 0o022) !== 0) chmodSync(at, stat.mode & 0o7755);
  }
}
