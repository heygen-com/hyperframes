import {
  chmodSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  statSync,
  type Stats,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";

const userCacheRoot = () => join(homedir(), ".cache", "hyperframes");

const GROUP_OR_WORLD_WRITE = 0o022;
const WITHOUT_GROUP_OR_WORLD_WRITE = 0o7755;
const STICKY = 0o1000;

const ownedByAnotherAccount = (stat: Stats, uid: number) => stat.uid !== uid && stat.uid !== 0;
const stickyFolder = (stat: Stats) => stat.isDirectory() && (stat.mode & STICKY) !== 0;

const anotherAccountCanWrite = (stat: Stats, uid: number, insideRoot: boolean) =>
  ownedByAnotherAccount(stat, uid) ||
  (!stat.isSymbolicLink() &&
    (stat.mode & GROUP_OR_WORLD_WRITE) !== 0 &&
    (insideRoot || !stickyFolder(stat)));

function statIfPresent(path: string): Stats | undefined {
  try {
    return statSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

const lstatIfPresent = (path: string) => lstatSync(path, { throwIfNoEntry: false });

function realpathIfPresent(path: string): string | undefined {
  try {
    return realpathSync(path);
  } catch {
    return undefined;
  }
}

const within = (path: string, top: string) => path === top || path.startsWith(top + sep);

function firstWritableByAnother(path: string, top: string, uid: number): string | undefined {
  for (let at = path; ; at = dirname(at)) {
    const stat = lstatIfPresent(at);
    const insideRoot = within(at, top);
    if (stat && anotherAccountCanWrite(stat, uid, insideRoot)) return at;
    if ((stat && !insideRoot) || at === dirname(at)) return undefined;
  }
}

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
  const at = resolve(path);
  const lexical = firstWritableByAnother(at, top, uid);
  if (lexical || !within(at, top)) return lexical;
  const realTop = realpathIfPresent(top);
  const real = realpathIfPresent(at);
  if (!realTop || !real) return undefined;
  return within(real, realTop) ? firstWritableByAnother(real, realTop, uid) : at;
}

export class CacheFolderNotPrivate extends Error {
  constructor(readonly path: string) {
    super(
      `${path} can be changed by another user account, so HyperFrames will not install or run code from it. ` +
        "Remove it, or set HYPERFRAMES_CACHE_DIR to a folder only you can write.",
    );
    this.name = "CacheFolderNotPrivate";
  }
}

export function assertPrivateCachePath(path: string, root: string): string {
  const foreign = foreignWritablePath(path, root);
  if (foreign) throw new CacheFolderNotPrivate(foreign);
  return path;
}

export function ensurePrivateCacheDir(path: string, root: string, mode = 0o700): string {
  const top = resolve(root);
  const target = resolve(path);
  if (!within(target, top)) throw new Error(`${target} is not inside ${top}`);
  const uid = process.getuid?.();
  if (uid === undefined) {
    mkdirSync(target, { recursive: true, mode });
    return target;
  }
  mkdirSync(dirname(top), { recursive: true });
  let at = top;
  for (const name of ["", ...relative(top, target).split(sep).filter(Boolean)]) {
    at = join(at, name);
    try {
      mkdirSync(at, { mode });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    const stat = lstatSync(at);
    if (stat.isDirectory() && stat.uid === uid && (stat.mode & GROUP_OR_WORLD_WRITE) !== 0)
      chmodSync(at, stat.mode & WITHOUT_GROUP_OR_WORLD_WRITE);
  }
  return assertPrivateCachePath(target, top);
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
    const stat = statIfPresent(at);
    if (stat?.uid === uid && (stat.mode & GROUP_OR_WORLD_WRITE) !== 0) {
      chmodSync(at, stat.mode & WITHOUT_GROUP_OR_WORLD_WRITE);
    }
  }
}
