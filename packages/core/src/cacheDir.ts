import { chmodSync, lstatSync, readdirSync, statSync, type Stats } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";

const userCacheRoot = () => join(homedir(), ".cache", "hyperframes");

const GROUP_OR_WORLD_WRITE = 0o022;
const WITHOUT_GROUP_OR_WORLD_WRITE = 0o7755;

const anotherAccountCanWrite = (stat: Stats, uid: number) =>
  (stat.uid !== uid && stat.uid !== 0) || (stat.mode & GROUP_OR_WORLD_WRITE) !== 0;

export function hyperframesCacheDir(...parts: string[]): string {
  const named = process.env["HYPERFRAMES_CACHE_DIR"];
  return join(named ? resolve(named) : userCacheRoot(), ...parts);
}

export function namedCacheDir(...parts: string[]): string | undefined {
  return process.env["HYPERFRAMES_CACHE_DIR"] ? hyperframesCacheDir(...parts) : undefined;
}

export function foreignWritablePath(path: string, root: string): string | undefined {
  const uid = process.getuid?.();
  if (uid === undefined) return undefined;
  const top = resolve(root);
  for (let at = resolve(path); ; at = dirname(at)) {
    const stat = statSync(at, { throwIfNoEntry: false });
    if (stat && anotherAccountCanWrite(stat, uid)) return at;
    const pastRoot = at === top || !at.startsWith(top + sep);
    if ((stat && pastRoot) || at === dirname(at)) return undefined;
  }
}

export function trustedCacheRoot(): string {
  const root = hyperframesCacheDir();
  return foreignWritablePath(root, root) ? userCacheRoot() : root;
}

export function sealCacheInstall(path: string, root: string): void {
  const uid = process.getuid?.();
  if (uid === undefined) return;
  const seal = (at: string) => {
    const stat = lstatSync(at, { throwIfNoEntry: false });
    if (!stat || stat.isSymbolicLink() || stat.uid !== uid) return;
    if ((stat.mode & GROUP_OR_WORLD_WRITE) !== 0)
      chmodSync(at, stat.mode & WITHOUT_GROUP_OR_WORLD_WRITE);
    if (stat.isDirectory()) for (const name of readdirSync(at)) seal(join(at, name));
  };
  seal(resolve(path));
  const top = resolve(root);
  for (let at = dirname(resolve(path)); at === top || at.startsWith(top + sep); at = dirname(at)) {
    const stat = statSync(at, { throwIfNoEntry: false });
    if (stat?.uid === uid && (stat.mode & GROUP_OR_WORLD_WRITE) !== 0) {
      chmodSync(at, stat.mode & WITHOUT_GROUP_OR_WORLD_WRITE);
    }
  }
}
