import { resolve, sep, join, dirname, basename, relative, isAbsolute, parse } from "node:path";
import { lstatSync, mkdirSync, realpathSync, statSync } from "node:fs";

export function realpath(path: string): string {
  try {
    return realpathSync.native(path);
  } catch (error) {
    // Some Windows volumes (RAM disks) refuse the native call with EISDIR.
    if ((error as NodeJS.ErrnoException).code === "EISDIR") return realpathSync(path);
    throw error;
  }
}

// realpath also fails for dangling/cyclic symlinks. Existing entries must not
// become missing segments: writes could follow them outside the project.
function isMissingPath(path: string): boolean {
  try {
    lstatSync(path);
    return false;
  } catch (error) {
    return Boolean(
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error.code === "ENOENT" || error.code === "ENOTDIR"),
    );
  }
}

// On Windows even a realpath or lstat of a UNC or device path (\\host\share, \\?\, \\.\) connects to that host.
function namesAnotherNetworkRoot(base: string, target: string): boolean {
  const root = parse(target).root;
  return /^[\\/]{2}/.test(root) && root.toLowerCase() !== parse(base).root.toLowerCase();
}

/**
 * Reject paths that escape the `base` directory — including via symlinks.
 *
 * `path.resolve()` collapses `.`/`..` but does NOT dereference symlinks, so a
 * plain prefix check (`resolved.startsWith(base + sep)`) can be defeated by a
 * symlink that lives *inside* `base` but points outside it (e.g.
 * `base/link -> /etc`). A downstream `readFileSync`/`writeFileSync`/`statSync`
 * then follows that link to a file outside `base`. To close this we canonicalize
 * both sides with `realpathSync.native` (the on-disk letter case too) before comparing.
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
  const target = resolve(resolved);
  if (namesAnotherNetworkRoot(resolve(base), target)) return false;
  let baseReal: string;
  try {
    baseReal = realpath(resolve(base));
  } catch {
    // Base must exist and be resolvable; fail closed if not.
    return false;
  }

  const trailing: string[] = [];
  let probe = target;

  for (;;) {
    let ancestorReal: string;
    try {
      ancestorReal = realpath(probe);
    } catch {
      if (!isMissingPath(probe)) return false;
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

/** Segments as Windows opens them: any case, no trailing dots or spaces, no `:stream` suffix. */
export function projectPathSegments(relPath: string): string[] {
  return relPath
    .toLowerCase()
    .split(/[\\/]/)
    .map((segment) => withoutTrailingDotsOrSpaces(segment.split(":", 1)[0] ?? ""));
}

function withoutTrailingDotsOrSpaces(segment: string): string {
  let end = segment.length;
  while (end > 0 && (segment[end - 1] === "." || segment[end - 1] === " ")) end--;
  return segment.slice(0, end);
}

// Git metadata and env files hold commands other tools run and secrets: nothing serves or inlines them.
export function isVcsOrSecretPath(relPath: string): boolean {
  return projectPathSegments(relPath).some(
    (segment) => segment === ".git" || segment.startsWith(".env"),
  );
}

// `.hyperframes/` holds the desktop app's and the CLI's own records (a hand-off, chat history, read marks): Studio
// reaches none of it, the folder itself included, but its own files and the app's request pictures.
const STUDIO_FILES = new Set([
  ".hyperframes/studio-motion.json",
  ".hyperframes/studio-manual-edits.json",
]);
const STUDIO_FOLDERS = [".hyperframes/prepared-assets", ".hyperframes/requests"];

/** Studio's private files, for a project-relative path with `/` separators: git, env, and the app's records. */
export function isStudioPrivatePath(relPath: string): boolean {
  const path = relPath.toLowerCase();
  if (isVcsOrSecretPath(path)) return true;
  return (
    (path === ".hyperframes" || path.startsWith(".hyperframes/")) &&
    !STUDIO_FILES.has(path) &&
    !STUDIO_FOLDERS.some((folder) => path === folder || path.startsWith(`${folder}/`))
  );
}

/** Whether `isPrivate` holds for a file under `projectDir`, spelled as given or with its links resolved. */
export function isPrivateFileUnder(
  projectDir: string,
  filePath: string,
  isPrivate: (relPath: string) => boolean,
): boolean {
  const rel = (from: string, to: string) => relative(from, to).split(sep).join("/");
  if (isPrivate(rel(resolve(projectDir), resolve(filePath)))) return true;
  try {
    return isPrivate(rel(realpath(resolve(projectDir)), realpath(filePath)));
  } catch {
    return false;
  }
}

/** The project folder is gone, renamed or deleted while open; a write must not bring it back. */
export class ProjectRootMissingError extends Error {
  constructor(readonly root: string) {
    super(`Project folder not found: ${root}`);
    this.name = "ProjectRootMissingError";
  }
}

// By name, so a copy of this module bundled into another package still matches.
export const isProjectRootMissing = (error: unknown): boolean =>
  error instanceof Error && error.name === "ProjectRootMissingError";

/** True only when nothing is at `dir` any more; a folder that cannot be looked at (EACCES, EIO) is not gone. */
export function folderGone(dir: string): boolean {
  try {
    return !statSync(dir, { throwIfNoEntry: false });
  } catch {
    return false;
  }
}

/** The project folder's real path; ProjectRootMissingError when it is gone. */
export function realProjectRoot(root: string): string {
  try {
    return realpath(root);
  } catch (error) {
    if (folderGone(root)) throw new ProjectRootMissingError(root);
    throw error;
  }
}

/**
 * Creates `dir` below `root` one folder at a time, so a root moved away fails instead of reappearing.
 * A `dir` outside `root` is created recursively, but only while `root` exists.
 */
export function mkdirWithinProject(root: string, dir: string): void {
  if (folderGone(root)) throw new ProjectRootMissingError(root);
  const inside = relative(resolve(root), resolve(dir));
  if (inside === ".." || inside.startsWith(`..${sep}`) || isAbsolute(inside)) {
    mkdirSync(dir, { recursive: true });
    return;
  }
  let path = resolve(root);
  for (const part of inside.split(sep).filter(Boolean)) {
    path = join(path, part);
    try {
      mkdirSync(path);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT" && folderGone(root)) throw new ProjectRootMissingError(root);
      if (code !== "EEXIST") throw error;
    }
  }
}
