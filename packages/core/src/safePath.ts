import { resolve, sep, join, dirname, basename, relative, isAbsolute, parse } from "node:path";
import { lstatSync, mkdirSync, realpathSync, statSync } from "node:fs";
import { projectPathSegments } from "@hyperframes/parsers/private-path";

export {
  isCredentialOrToolStatePath,
  isPrivateFileUnder,
  isStudioPrivatePath,
  isVcsOrSecretPath,
  projectPathSegments,
} from "@hyperframes/parsers/private-path";

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

// Files another program runs or trusts with the developer's rights: a package manager, a shell, a build or IDE tool, or
// a coding agent. No composition needs one, so registry content never installs one (an example may bring its own
// project configuration) and Studio's write routes never write, rename onto or delete one.
const PROJECT_CONFIG_FILES = new Set(["package.json", "hyperframes.json", "hyperframes.lock.json"]);
const LOCK_FILES = new Set([
  "package-lock.json",
  "npm-shrinkwrap.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
  "deno.lock",
]);
const TOOL_CONFIG_FILES = new Set([
  "tsconfig.json",
  "jsconfig.json",
  "deno.json",
  "deno.jsonc",
  "bunfig.toml",
  "makefile",
  "gnumakefile",
  "justfile",
  "procfile",
  "turbo.json",
  "nx.json",
  "pyproject.toml",
  // Agents that read their settings, including commands to run, from the project folder.
  "opencode.json",
  "opencode.jsonc",
  "crush.json",
  // Dev servers, environment managers and deploy CLIs that run a command the file names.
  "nodemon.json",
  "devbox.json",
  "devenv.yaml",
  "wrangler.toml",
  "wrangler.json",
  "wrangler.jsonc",
  "vercel.json",
  "netlify.toml",
  "composer.json",
  // Ruby and other build files that are code in their own right.
  "rakefile",
  "gemfile",
  "vagrantfile",
  "tiltfile",
  "earthfile",
  "brewfile",
]);
// The same tools' other spellings and the files they load alongside their main config.
const TOOL_CONFIG_FAMILIES = [
  /^(?:docker-)?compose(?:\.override)?\.ya?ml$/,
  /^(?:dockerfile|containerfile)(?:\..+)?$|\.(?:docker|container)file$/,
  /^lefthook(?:-local)?\.(?:ya?ml|jsonc?|toml)$/,
  /^taskfile(?:\.dist)?\.ya?ml$/,
  /^mise(?:\.[^.]+)*\.toml$/,
  /^simple-git-hooks\.(?:json|[cm]?js)$/,
  /^[jt]sconfig\..+\.json$/,
  /\.gypi?$/,
];
const RUN_BY_PACKAGE_MANAGER_DEFAULT = new Set(["server.js"]);
// Tools load these on their own: vite.config.ts, jest.config.json, docker-compose.yml, gulpfile.js and the like.
const TOOL_CONFIG =
  /\.config\.(?:[cm]?[jt]sx?|json[c5]?|ya?ml|toml)$|^(?:gulp|grunt)file\.[cm]?[jt]s$/;
// Coding agents load these on their own, wherever they sit.
const AGENT_INSTRUCTIONS =
  /^(agents?|claude|gemini|qwen|crush|warp|conventions|copilot-instructions)(\.[a-z]+)?\.md$/;
// Programs and scripts a shell, an OS or another tool runs; a browser composition never needs them.
const PROGRAM_EXTENSIONS =
  "exe com bat cmd ps1 psm1 vbs vbe wsf hta msi scr pif cpl lnk dll so dylib node sh bash zsh fish command jar appimage py rb pl php nix".split(
    " ",
  );
const PROGRAM = new RegExp(`\\.(?:${PROGRAM_EXTENSIONS.join("|")})$`);
// A Windows short name such as `CLAUDE~1` or `PACKAG~1.JSO` opens a long name on NTFS. Its extension is the first three
// letters of the long one, so `take~2.mp4` cannot stand for any of the files above; a name with none may be a folder.
const SHORT_NAME = /^([^.]{1,6}~\d{1,6})(?:\.([^.]{1,3}))?$/;
const TRUSTED_EXTENSIONS = [
  ...PROGRAM_EXTENSIONS,
  ...["json", "jsonc", "json5", "yaml", "yml", "toml", "lock", "lockb", "md"],
  ...["js", "mjs", "cjs", "jsx", "ts", "mts", "cts", "tsx"],
];

function isShortName(segment: string): boolean {
  const match = SHORT_NAME.exec(segment);
  if (!match || match[1]!.length > 8) return false;
  const extension = match[2];
  return !extension || TRUSTED_EXTENSIONS.some((trusted) => trusted.startsWith(extension));
}

function isToolConfig(name: string, segments: readonly string[]): boolean {
  if (TOOL_CONFIG_FILES.has(name) || TOOL_CONFIG.test(name)) return true;
  if (TOOL_CONFIG_FAMILIES.some((family) => family.test(name))) return true;
  return name === "config.toml" && segments.at(-2) === "mise";
}

/** What makes a file one another program runs or trusts; see `toolTrustedFileKind`. */
export type ToolTrustedKind =
  | "short-name"
  | "project-config"
  | "lock-file"
  | "tool-config"
  | "agent-instructions"
  | "program";

/**
 * Why another program runs or trusts the file at a project-relative path, or null for an ordinary project file. The
 * path is read in every spelling a case-insensitive file system or Windows opens: any case or Unicode form, either
 * separator, trailing dots or spaces, a `:stream` suffix, or a short name for any of these.
 */
export function toolTrustedFileKind(relPath: string): ToolTrustedKind | null {
  const segments = projectPathSegments(relPath);
  while (segments.length > 1 && segments.at(-1) === "") segments.pop();
  const name = segments.at(-1) ?? "";
  if (segments.some(isShortName)) return "short-name";
  if (PROJECT_CONFIG_FILES.has(name)) return "project-config";
  if (LOCK_FILES.has(name)) return "lock-file";
  if (isToolConfig(name, segments)) return "tool-config";
  if (AGENT_INSTRUCTIONS.test(name)) return "agent-instructions";
  if (PROGRAM.test(name) || RUN_BY_PACKAGE_MANAGER_DEFAULT.has(name)) return "program";
  return null;
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
