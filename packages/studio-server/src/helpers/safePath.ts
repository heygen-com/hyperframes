import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readdirSync,
  readFileSync,
  statSync,
  type Dirent,
  type Stats,
} from "node:fs";
import {
  isStudioPrivatePath,
  mkdirWithinProject,
  projectPathSegments,
  realpath,
  resolveWithinProject as resolveInProject,
  toolTrustedFileKind,
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
  realpath,
  realProjectRoot,
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

/** The real path; for a path not there (yet, or any more), the nearest existing folder's real path plus the rest. */
export function realFilePath(filePath: string): string {
  try {
    return realpath(filePath);
  } catch {
    const dir = dirname(filePath);
    return dir === filePath ? filePath : join(realFilePath(dir), basename(filePath));
  }
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

export function isWritableProjectFile(projectDir: string, filePath: string): boolean {
  return projectRelatives(projectDir, filePath).every((path) =>
    isWritableInProject(projectDir, path),
  );
}

/** `isWritableProjectPath`, and not a script the project's package.json runs. */
export function isWritableInProject(projectDir: string, relPath: string): boolean {
  return isWritableProjectPath(relPath) && !scriptsPackageRuns(projectDir).has(foldedPath(relPath));
}

// A word in package.json that names a JavaScript or TypeScript file: `node server.js`, `tsx ./scripts/build.ts`.
const SCRIPT_FILE = /\.[cm]?[jt]sx?$/;
const SHELL_WORD_BREAKS = /[\s;&|()<>"'`=,]+/;
const NO_SCRIPTS: ReadonlySet<string> = new Set();
const packageScripts = new Map<string, { stat: string; files: ReadonlySet<string> }>();

const foldedPath = (path: string): string =>
  projectPathSegments(path)
    .filter((segment) => segment !== "" && segment !== ".")
    .join("/");

/**
 * The script files the project's package.json runs (its `main`, `bin` and every script file its scripts name), folded
 * as `projectPathSegments` folds. npm, node or a tool runs these with the developer's rights.
 */
function scriptsPackageRuns(projectDir: string): ReadonlySet<string> {
  const path = join(projectDir, "package.json");
  const stat = statSync(path, { throwIfNoEntry: false });
  if (!stat?.isFile()) return NO_SCRIPTS;
  const key = `${stat.ino}:${stat.size}:${stat.mtimeMs}`;
  const cached = packageScripts.get(path);
  if (cached?.stat === key) return cached.files;
  const files = scriptFilesNamedBy(readPackageJson(path));
  packageScripts.set(path, { stat: key, files });
  return files;
}

function readPackageJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

function scriptFilesNamedBy(pkg: unknown): ReadonlySet<string> {
  if (!pkg || typeof pkg !== "object") return NO_SCRIPTS;
  const { main, bin, scripts }: { main?: unknown; bin?: unknown; scripts?: unknown } = pkg;
  const words = [main, ...valuesOf(bin), ...valuesOf(scripts)].flatMap((value) =>
    typeof value === "string" ? value.split(SHELL_WORD_BREAKS) : [],
  );
  const files = words.filter(
    (word) => SCRIPT_FILE.test(word) && !word.split(/[\\/]/).includes(".."),
  );
  return new Set(files.map(foldedPath));
}

const valuesOf = (value: unknown): unknown[] =>
  typeof value === "string"
    ? [value]
    : value && typeof value === "object"
      ? Object.values(value)
      : [];

/**
 * The first entry below `dir` a folder delete or move must not take along: one a direct delete or rename refuses, a
 * `toolTrustedFileKind` file or a script package.json runs, or `node_modules` or `.git`. Given `to`, a move's
 * destination, also one arriving where a direct write refuses. Links are not followed; an unreadable folder is refused.
 */
export function protectedEntryWithin(projectDir: string, dir: string, to?: string): string | null {
  const from = projectRelativePath(projectDir, dir);
  const places = [dir, ...(to === undefined ? [] : [to])].flatMap((at) =>
    projectRelatives(projectDir, at),
  );
  const runs = scriptsPackageRuns(projectDir);
  const refused = (sub: string) =>
    places.some((place) => {
      const at = place ? `${place}/${sub}` : sub;
      return toolTrustedFileKind(at) !== null || runs.has(foldedPath(at));
    });
  const found = refusedEntryBelow(dir, "", refused);
  return found === null ? null : [from, found].filter(Boolean).join("/") || ".";
}

const PROTECTED_FOLDERS = new Set(["node_modules", ".git"]);

function refusedEntryBelow(
  dir: string,
  sub: string,
  refused: (sub: string) => boolean,
): string | null {
  const entries = folderEntries(dir);
  if (!entries) return sub;
  for (const entry of entries) {
    const at = sub ? `${sub}/${entry.name}` : entry.name;
    if (refused(at)) return at;
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

export function resolveWritableWithinProject(base: string, relativePath: string): string | null {
  const resolved = resolveWithinProject(base, relativePath);
  return resolved && isWritableProjectFile(base, resolved) ? resolved : null;
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
  const inside = relative(resolve(root), resolve(dir));
  if (inside === ".." || inside.startsWith(`..${sep}`) || isAbsolute(inside)) return false;
  let path = resolve(root);
  for (const part of inside.split(sep).filter(Boolean)) {
    path = join(path, part);
    const stat = lstatSync(path, { throwIfNoEntry: false });
    if (stat?.isSymbolicLink()) return false;
    if (!stat?.isDirectory()) return true;
  }
  return true;
}

/** A file Studio keeps under the project, such as a cache entry: a plain file, reached with no link from `root` down. */
export function isProjectCacheFile(root: string, file: string): boolean {
  if (!isLinkFreeWithinProject(root, dirname(file))) return false;
  const stat = lstatSync(file, { throwIfNoEntry: false });
  return stat !== undefined && isPlainFileWithOneName(stat);
}

const isPlainFileWithOneName = (stat: Stats) => stat.isFile() && stat.nlink === 1;

const NO_FOLLOW_READ =
  constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0);

const sameFile = (a: Stats | undefined, b: Stats) =>
  a !== undefined && !a.isSymbolicLink() && a.dev === b.dev && a.ino === b.ino;

/** `isProjectCacheFile`'s bytes, opened without following a link, or null; a hard link or one over `maxBytes` is a miss too. */
export function readProjectCacheFile(root: string, file: string, maxBytes: number): Buffer | null {
  if (!isLinkFreeWithinProject(root, dirname(file))) return null;
  let fd: number;
  try {
    fd = openSync(file, NO_FOLLOW_READ);
  } catch {
    return null;
  }
  try {
    const stat = fstatSync(fd);
    if (!isPlainFileWithOneName(stat) || stat.size > maxBytes) return null;
    // Without O_NOFOLLOW (Windows) the open followed a link, so the name must still be this plain file.
    if (
      constants.O_NOFOLLOW === undefined &&
      !sameFile(lstatSync(file, { throwIfNoEntry: false }), stat)
    )
      return null;
    return readFileSync(fd);
  } catch {
    return null;
  } finally {
    closeSync(fd);
  }
}

/** `mkdirWithinProject` for the tool's own caches and records: a link on the way would put their files outside the project. */
export function mkdirOwnedWithinProject(root: string, dir: string): void {
  if (!isLinkFreeWithinProject(root, dir)) throw new Error(`A link stands in for a folder: ${dir}`);
  mkdirWithinProject(root, dir);
}

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
    const code = (err as NodeJS.ErrnoException).code;
    if (!prefix || !code || !UNREADABLE_DIR_CODES.has(code)) throw err;
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (IGNORE_DIRS.has(entry.name) || RENDER_TEMP_DIR.test(entry.name) || shouldIgnoreDir(rel))
      continue;
    if (entry.isDirectory()) {
      files.push(...walkDir(join(dir, entry.name), rel));
    } else {
      files.push(rel);
    }
  }
  return files;
}
