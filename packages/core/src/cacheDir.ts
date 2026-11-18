import {
  chmodSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  type Stats,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

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

const lstatIfPresent = (path: string) => lstatSync(path, { throwIfNoEntry: false });

function resolvedPath(path: string): string {
  try {
    return realpathSync(path);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    const parent = dirname(path);
    return parent === path ? path : join(resolvedPath(parent), relative(parent, path));
  }
}

function within(path: string, top: string): boolean {
  const suffix = relative(top, path);
  return suffix !== ".." && !suffix.startsWith(".." + sep) && !isAbsolute(suffix);
}

function linkTargetPath(path: string): string {
  const link = readlinkSync(path);
  return isAbsolute(link) ? link : dirname(path) + sep + link;
}

function firstWritableByAnother(
  path: string,
  top: string,
  uid: number,
  links = new Set<string>(),
): string | undefined {
  for (let at = path; ; at = dirname(at)) {
    const stat = lstatIfPresent(at);
    if (stat && anotherAccountCanWrite(stat, uid, within(at, top))) return at;
    if (stat?.isSymbolicLink()) {
      if (links.has(at)) return at;
      links.add(at);
      const foreign = firstWritableByAnother(linkTargetPath(at), top, uid, links);
      if (foreign) return foreign;
      links.delete(at);
    }
    if (at === dirname(at)) return undefined;
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
  const realTop = resolvedPath(top);
  const real = resolvedPath(at);
  return within(real, realTop) ? firstWritableByAnother(real, realTop, uid) : at;
}

export function foreignWritableTree(path: string, root: string): string | undefined {
  if (process.getuid?.() === undefined) return undefined;
  const initial = foreignWritablePath(path, root);
  if (initial) return initial;
  const top = resolvedPath(root);
  const pending = [resolvedPath(path)];
  const visited = new Set<string>();
  for (const at of pending) {
    const foreign = foreignWritablePath(at, top);
    if (foreign) return foreign;
    const real = resolvedPath(at);
    if (visited.has(real)) continue;
    visited.add(real);
    const stat = lstatIfPresent(real);
    if (!stat) return at;
    if (stat.isDirectory()) for (const name of readdirSync(real)) pending.push(join(real, name));
  }
  return undefined;
}

export class CacheFolderNotPrivate extends Error {
  constructor(readonly path: string) {
    super(
      `${path} can be changed by another user account, so HyperFrames will not install or run code from it. ` +
        "If you own this directory, remove its group/other write permissions (chmod go-w). " +
        "Otherwise set HYPERFRAMES_CACHE_DIR to a private directory whose parents are also private. " +
        "An existing group-writable ~/.cache is refused; its permissions are never changed automatically.",
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
  assertPrivateCachePath(dirname(top), top);
  mkdirSync(dirname(top), { recursive: true, mode: 0o700 });
  let at = top;
  for (const name of ["", ...relative(top, target).split(sep).filter(Boolean)]) {
    at = join(at, name);
    try {
      mkdirSync(at, { mode });
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
    }
    const stat = lstatSync(at);
    if (!stat.isDirectory() && !stat.isSymbolicLink()) throw new CacheFolderNotPrivate(at);
    if (stat.isDirectory() && stat.uid === uid && (stat.mode & GROUP_OR_WORLD_WRITE) !== 0)
      chmodSync(at, stat.mode & WITHOUT_GROUP_OR_WORLD_WRITE);
    assertPrivateCachePath(at, top);
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
  const top = resolve(root);
  const target = resolve(path);
  if (!within(target, top) || !within(resolvedPath(target), resolvedPath(top)))
    throw new CacheFolderNotPrivate(target);
  assertPrivateCachePath(dirname(top), top);
  const sealPermissions = (at: string, stat: Stats): void => {
    if (ownedByAnotherAccount(stat, uid)) throw new CacheFolderNotPrivate(at);
    if ((stat.mode & GROUP_OR_WORLD_WRITE) === 0) return;
    if (stat.uid !== uid) throw new CacheFolderNotPrivate(at);
    chmodSync(at, stat.mode & WITHOUT_GROUP_OR_WORLD_WRITE);
  };
  const links: string[] = [];
  const seal = (at: string) => {
    const stat = lstatIfPresent(at);
    if (!stat) return;
    if (stat.isSymbolicLink()) {
      links.push(at);
      return;
    }
    sealPermissions(at, stat);
    if (stat.isDirectory()) for (const name of readdirSync(at)) seal(join(at, name));
  };
  for (let at = top; ; ) {
    if (at === target) break;
    sealDirectory(at);
    const next = relative(at, target).split(sep)[0];
    if (!next) break;
    at = join(at, next);
  }
  seal(target);
  for (const link of links) assertPrivateCachePath(link, top);

  function sealDirectory(at: string): void {
    const stat = lstatIfPresent(at);
    if (stat?.isDirectory()) sealPermissions(at, stat);
    assertPrivateCachePath(at, top);
  }
}
