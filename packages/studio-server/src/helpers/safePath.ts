import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { constants, lstatSync, readdirSync, statSync, type Dirent, type Stats } from "node:fs";
import { lstat, open, readdir, stat, type FileHandle } from "node:fs/promises";
import {
  isStudioPrivatePath,
  mkdirWithinProject,
  mkdirWithinProjectAsync,
  nodeMayRun,
  projectPathSegments,
  ProjectRootMissingError,
  realFilePath,
  realpathOff,
  resolveWithinProject as resolveInProject,
  toolTrustedFileKind,
  type EntryKind,
} from "@hyperframes/core/safe-path";
import { RENDER_TEMP_DIR } from "@hyperframes/core/project-folders";

// `isSafePath` lives at the package root so non-studio-api layers (compiler,
// CLI, engine) can share it without a backwards dependency on studio-api.
// Re-exported here for back-compat with existing `../helpers/safePath.js` imports.
export {
  folderGone,
  isProjectRootMissing,
  isSafePath,
  mkdirWithinProject,
  realFilePath,
  realpath,
  realpathOff,
  realProjectRoot,
  type EntryKind,
} from "@hyperframes/core/safe-path";

/** Core's `resolveWithinProject`, closed to the desktop app's private files for every route a request path reaches. */
export function resolveWithinProject(base: string, relativePath: string): string | null {
  const resolved = resolveInProject(base, relativePath);
  return resolved && !isPrivateProjectFile(base, resolved) ? resolved : null;
}

/** A path inside the project spelled one way: relative to `base`, `/`-separated, no `.` or `..` segments. */
export function projectRelativePath(base: string, file: string): string {
  return relative(resolve(base), resolve(file)).split(sep).join("/");
}

/** For a project-relative path with `/` separators; the bundler applies the same rule to preview builds. */
export const isPrivateProjectPath = isStudioPrivatePath;

const projectRelatives = (projectDir: string, filePath: string): string[] => {
  const rel = (from: string, to: string) => relative(from, to).split(sep).join("/");
  return [rel(projectDir, filePath), rel(realFilePath(projectDir), realFilePath(filePath))];
};

export function isPrivateProjectFile(projectDir: string, filePath: string): boolean {
  return projectRelatives(projectDir, filePath).some(isPrivateProjectPath);
}

const WRITABLE_HIDDEN_FOLDERS = new Set([".hyperframes", ".media"]);

/** Writes refuse the project folder, node_modules, hidden paths but Studio's records, and `toolTrustedFileKind` files. */
export function isWritableProjectPath(relPath: string): boolean {
  if (!relPath || isPrivateProjectPath(relPath) || toolTrustedFileKind(relPath)) return false;
  const segments = projectPathSegments(relPath);
  return segments.every(
    (segment, at) =>
      segment !== "" &&
      segment !== "node_modules" &&
      (!segment.startsWith(".") || (at === 0 && WRITABLE_HIDDEN_FOLDERS.has(segment))),
  );
}

const entryKindAt = (path: string): EntryKind =>
  statSync(path, { throwIfNoEntry: false })?.isDirectory() ? "folder" : "file";

export function isWritableProjectFile(
  projectDir: string,
  filePath: string,
  kind: EntryKind = entryKindAt(filePath),
): boolean {
  return projectRelatives(projectDir, filePath).every((path) =>
    isWritableInProject(projectDir, path, kind),
  );
}

/** `isWritableProjectPath`, and not a script the project's Node tooling may run. */
export function isWritableInProject(
  projectDir: string,
  relPath: string,
  kind: EntryKind = entryKindAt(resolve(projectDir, relPath)),
): boolean {
  return isWritableProjectPath(relPath) && !nodeMayRun(projectDir, relPath, kind);
}

/**
 * The first entry below `dir` a folder delete or move must not take along: one a direct delete or rename refuses, a
 * `toolTrustedFileKind` file or a script Node tooling may run, or `node_modules` or `.git`. Given `to`, a move's
 * destination, also one arriving where a direct write refuses. Links are not followed; an unreadable folder is refused.
 */
export function protectedEntryWithin(projectDir: string, dir: string, to?: string): string | null {
  const from = projectRelativePath(projectDir, dir);
  const places = [dir, ...(to === undefined ? [] : [to])].flatMap((at) =>
    projectRelatives(projectDir, at),
  );
  const refused = (sub: string, kind: EntryKind) =>
    places.some((place) => {
      const at = place ? `${place}/${sub}` : sub;
      return toolTrustedFileKind(at) !== null || nodeMayRun(projectDir, at, kind);
    });
  const found = refusedEntryBelow(dir, "", refused);
  return found === null ? null : [from, found].filter(Boolean).join("/") || ".";
}

const PROTECTED_FOLDERS = new Set(["node_modules", ".git"]);

const kindOf = (entry: Dirent): EntryKind => (entry.isDirectory() ? "folder" : "file");

function refusedEntryBelow(
  dir: string,
  sub: string,
  refused: (sub: string, kind: EntryKind) => boolean,
): string | null {
  const entries = folderEntries(dir);
  if (!entries) return sub;
  for (const entry of entries) {
    const at = sub ? `${sub}/${entry.name}` : entry.name;
    if (refused(at, kindOf(entry))) return at;
    if (!entry.isDirectory()) continue;
    if (PROTECTED_FOLDERS.has(projectPathSegments(entry.name)[0] ?? "")) return at;
    const inside = refusedEntryBelow(join(dir, entry.name), at, refused);
    if (inside !== null) return inside;
  }
  return null;
}

function folderEntries(dir: string): Dirent[] | null {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    if (UNREADABLE_DIR_CODES.has((err as NodeJS.ErrnoException).code ?? "")) return null;
    throw err;
  }
}

export function resolveWritableWithinProject(
  base: string,
  relativePath: string,
  kind?: EntryKind,
): string | null {
  const resolved = resolveWithinProject(base, relativePath);
  return resolved && isWritableProjectFile(base, resolved, kind) ? resolved : null;
}

export function pinWritableWithinProject(base: string, relativePath: string): string | null {
  return pinResolved(base, resolveWritableWithinProject(base, relativePath));
}

/**
 * `resolveWithinProject` with every link inside the project resolved now, so a write to the result lands on the
 * file checked here even if a link on the way is retargeted before the write.
 */
export function pinWithinProject(base: string, relativePath: string): string | null {
  return pinResolved(base, resolveWithinProject(base, relativePath));
}

/** `pinWithinProject` for the app's and the CLI's own records under `.hyperframes/`, which no route serves. */
export function pinProjectRecord(base: string, relativePath: string): string | null {
  return pinResolved(base, resolveInProject(base, relativePath));
}

function pinResolved(base: string, checked: string | null): string | null {
  if (!checked) return null;
  const inside = relative(realFilePath(base), realFilePath(checked));
  const escapes = inside === ".." || inside.startsWith(`..${sep}`) || isAbsolute(inside);
  return escapes ? null : join(base, inside);
}

/** True when no entry from `root` down to `dir` is a link. A file in the way is left for mkdir or readdir to report. */
export function isLinkFreeWithinProject(root: string, dir: string): boolean {
  const paths = pathsDownTo(root, dir);
  if (paths === null) return false;
  for (const path of paths) {
    const free = linkFreeSoFar(lstatSync(path, { throwIfNoEntry: false }));
    if (free !== undefined) return free;
  }
  return true;
}

async function isLinkFreeWithinProjectAsync(root: string, dir: string): Promise<boolean> {
  const paths = pathsDownTo(root, dir);
  if (paths === null) return false;
  for (const path of paths) {
    const free = linkFreeSoFar(await lstat(path).catch(missingAsUndefined));
    if (free !== undefined) return free;
  }
  return true;
}

function pathsDownTo(root: string, dir: string): string[] | null {
  const inside = relative(resolve(root), resolve(dir));
  if (inside === ".." || inside.startsWith(`..${sep}`) || isAbsolute(inside)) return null;
  let path = resolve(root);
  return inside
    .split(sep)
    .filter(Boolean)
    .map((part) => (path = join(path, part)));
}

const linkFreeSoFar = (stat: Stats | undefined): boolean | undefined =>
  stat?.isSymbolicLink() ? false : stat?.isDirectory() ? undefined : true;

const missingAsUndefined = (error: unknown): undefined => {
  if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
  throw error;
};

/** A file Studio keeps under the project, such as a cache entry: a plain file, reached with no link from `root` down. */
export function isProjectCacheFile(root: string, file: string): boolean {
  if (!isLinkFreeWithinProject(root, dirname(file))) return false;
  const stat = lstatSync(file, { throwIfNoEntry: false });
  return stat !== undefined && isPlainFileWithOneName(stat);
}

export async function isProjectCacheFileAsync(root: string, file: string): Promise<boolean> {
  if (!(await isLinkFreeWithinProjectAsync(root, dirname(file)))) return false;
  const found = await lstat(file).catch(missingAsUndefined);
  return found !== undefined && isPlainFileWithOneName(found);
}

export async function realProjectRootAsync(root: string): Promise<string> {
  try {
    return await realpathOff(root);
  } catch (error) {
    if ((await stat(root).catch(missingAsUndefined)) === undefined)
      throw new ProjectRootMissingError(root);
    throw error;
  }
}

const isPlainFileWithOneName = (stat: Stats) => stat.isFile() && stat.nlink === 1;

const NO_FOLLOW_READ =
  constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0);

const sameFile = (a: Stats | undefined, b: Stats) =>
  a !== undefined && !a.isSymbolicLink() && a.dev === b.dev && a.ino === b.ino;

/** `isProjectCacheFile`'s bytes, opened without following a link, or null (a hard link or one over `maxBytes` too),
 * all off the server's thread: a disk that stops answering holds only the request. */
export async function readProjectCacheFileAsync(
  root: string,
  file: string,
  maxBytes: number,
): Promise<Buffer | null> {
  if (!(await isLinkFreeWithinProjectAsync(root, dirname(file)))) return null;
  let handle: FileHandle;
  try {
    handle = await open(file, NO_FOLLOW_READ);
  } catch {
    return null;
  }
  try {
    const stat = await handle.stat();
    if (!isPlainFileWithOneName(stat) || stat.size > maxBytes) return null;
    if (
      constants.O_NOFOLLOW === undefined &&
      !sameFile(await lstat(file).catch(missingAsUndefined), stat)
    )
      return null;
    return await handle.readFile();
  } catch {
    return null;
  } finally {
    await handle.close();
  }
}

/** `mkdirWithinProject` for the tool's own caches and records: a link on the way would put their files outside the project. */
export function mkdirOwnedWithinProject(root: string, dir: string): void {
  refuseLinkOnTheWay(root, dir);
  mkdirWithinProject(root, dir);
}

export async function mkdirOwnedWithinProjectAsync(root: string, dir: string): Promise<void> {
  if (!(await isLinkFreeWithinProjectAsync(root, dir))) throw linkStandsIn(dir);
  await mkdirWithinProjectAsync(root, dir);
}

function refuseLinkOnTheWay(root: string, dir: string): void {
  if (!isLinkFreeWithinProject(root, dir)) throw linkStandsIn(dir);
}

const linkStandsIn = (dir: string) => new Error(`A link stands in for a folder: ${dir}`);

const IGNORE_DIRS = new Set([
  ".thumbnails",
  ".transcode-cache",
  ".waveform-cache",
  "node_modules",
  ".git",
]);

function shouldIgnoreDir(rel: string): boolean {
  const segments = projectPathSegments(rel);
  return segments.at(-1) === "backup" && segments.at(-2) === ".hyperframes";
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

const UNREADABLE_DIR_CODES = new Set(["EACCES", "EPERM", "ENOENT", "ENOTDIR"]);

/** Recursively walk a directory and return relative file paths. A subfolder that is unreadable
 * or removed mid-walk is skipped; any other failure, or an unreadable `dir` itself, throws. */
export function walkDir(dir: string, prefix = ""): string[] {
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    return skippedUnreadable(err, prefix);
  }
  const files: string[] = [];
  for (const entry of entries) {
    const walked = walkedEntry(entry, prefix);
    if (walked)
      files.push(...(walked.folder ? walkDir(join(dir, entry.name), walked.rel) : [walked.rel]));
  }
  return files;
}

export async function walkDirAsync(dir: string, prefix = ""): Promise<string[]> {
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    return skippedUnreadable(err, prefix);
  }
  const files: string[] = [];
  for (const entry of entries) {
    const walked = walkedEntry(entry, prefix);
    if (walked)
      files.push(
        ...(walked.folder ? await walkDirAsync(join(dir, entry.name), walked.rel) : [walked.rel]),
      );
  }
  return files;
}

function walkedEntry(entry: Dirent, prefix: string): { rel: string; folder: boolean } | null {
  const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
  if (IGNORE_DIRS.has(entry.name) || RENDER_TEMP_DIR.test(entry.name) || shouldIgnoreDir(rel))
    return null;
  return { rel, folder: entry.isDirectory() };
}

function skippedUnreadable(err: unknown, prefix: string): string[] {
  const code = (err as NodeJS.ErrnoException).code;
  if (!prefix || !code || !UNREADABLE_DIR_CODES.has(code)) throw err;
  return [];
}
