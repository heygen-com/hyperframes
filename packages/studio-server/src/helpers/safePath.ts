import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { lstatSync, readdirSync, type Dirent } from "node:fs";
import {
  isStudioPrivatePath,
  mkdirWithinProject,
  projectPathSegments,
  realpath,
  resolveWithinProject as resolveInProject,
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

/** Writes refuse the project folder, node_modules, and hidden paths but Studio's records and the media ledger. */
export function isWritableProjectPath(relPath: string): boolean {
  if (!relPath || isPrivateProjectPath(relPath)) return false;
  const segments = projectPathSegments(relPath);
  return segments.every(
    (segment, at) =>
      segment !== "" &&
      segment !== "node_modules" &&
      (!segment.startsWith(".") || (at === 0 && WRITABLE_HIDDEN_FOLDERS.has(segment))),
  );
}

export function isWritableProjectFile(projectDir: string, filePath: string): boolean {
  return projectRelatives(projectDir, filePath).every(isWritableProjectPath);
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
  return rel === ".hyperframes/backup";
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
