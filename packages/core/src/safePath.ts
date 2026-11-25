import { resolve, sep, join, dirname, basename, relative, isAbsolute, parse } from "node:path";
import {
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpath as realpathWalk,
  realpathSync,
  statSync,
} from "node:fs";
import { mkdir, realpath as realpathNative, stat as statAsync } from "node:fs/promises";
import { promisify } from "node:util";
import { isWithinProjectRoot } from "@hyperframes/parsers/asset-resolution";
import { projectPathSegments } from "@hyperframes/parsers/private-path";

export {
  isCredentialOrToolStatePath,
  isPrivateFileUnder,
  isStudioPrivatePath,
  isVcsOrSecretPath,
  projectPathSegments,
} from "@hyperframes/parsers/private-path";

// Some Windows volumes (RAM disks) refuse the native realpath with EISDIR; the JS walk still resolves there.
const nativeRefused = (error: unknown) => (error as NodeJS.ErrnoException).code === "EISDIR";

export function realpath(path: string): string {
  try {
    return realpathSync.native(path);
  } catch (error) {
    if (nativeRefused(error)) return realpathSync(path);
    throw error;
  }
}

/** `realpath` off the event loop: the same answer, the EISDIR fallback included. */
export async function realpathOff(path: string): Promise<string> {
  try {
    return await realpathNative(path);
  } catch (error) {
    if (nativeRefused(error)) return promisify(realpathWalk)(path);
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
  if (!isWithinProjectRoot(base, target) && !isWithinProjectRoot(baseReal, target)) return false;

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
    return realPathWithin(baseReal, targetReal);
  }
}

/** The containment rule once both sides are real paths. */
export const realPathWithin = (baseReal: string, targetReal: string): boolean =>
  targetReal === baseReal || targetReal.startsWith(baseReal + sep);

/** `resolveWithinProject` off the event loop: the absolute path of an existing entry inside `base`, else null. */
export async function resolveExistingWithinProjectOff(
  base: string,
  relativePath: string,
): Promise<string | null> {
  const resolved = resolve(base, relativePath);
  if (namesAnotherNetworkRoot(resolve(base), resolved)) return null;
  const real = await Promise.all([realpathOff(resolve(base)), realpathOff(resolved)]).catch(
    () => null,
  );
  return real !== null && realPathWithin(real[0], real[1]) ? resolved : null;
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

async function folderGoneAsync(dir: string): Promise<boolean> {
  try {
    await statAsync(dir);
    return false;
  } catch (error) {
    return isMissing(error);
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
  const folders = foldersToMake(root, dir, folderGone(root));
  if (folders === null) {
    mkdirSync(dir, { recursive: true });
    return;
  }
  for (const path of folders) {
    try {
      mkdirSync(path);
    } catch (error) {
      madeOrThrow(root, error, isMissing(error) && folderGone(root));
    }
  }
}

/** {@link mkdirWithinProject} on fs/promises: a write the drive never answers holds a pool thread, not the caller's. */
export async function mkdirWithinProjectAsync(root: string, dir: string): Promise<void> {
  const folders = foldersToMake(root, dir, await folderGoneAsync(root));
  if (folders === null) {
    await mkdir(dir, { recursive: true });
    return;
  }
  for (const path of folders) {
    try {
      await mkdir(path);
    } catch (error) {
      madeOrThrow(root, error, isMissing(error) && (await folderGoneAsync(root)));
    }
  }
}

/** Each folder from below `root` down to `dir`, or null when `dir` is outside `root`. */
function foldersToMake(root: string, dir: string, rootGone: boolean): string[] | null {
  if (rootGone) throw new ProjectRootMissingError(root);
  const inside = relative(resolve(root), resolve(dir));
  if (inside === ".." || inside.startsWith(`..${sep}`) || isAbsolute(inside)) return null;
  let path = resolve(root);
  return inside
    .split(sep)
    .filter(Boolean)
    .map((part) => (path = join(path, part)));
}

function madeOrThrow(root: string, error: unknown, rootGone: boolean): void {
  if (rootGone) throw new ProjectRootMissingError(root);
  if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
}

const isMissing = (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT";

/** The real path; for a path not there (yet, or any more), the nearest existing folder's real path plus the rest. */
export function realFilePath(filePath: string): string {
  try {
    return realpath(filePath);
  } catch {
    const dir = dirname(filePath);
    return dir === filePath ? filePath : join(realFilePath(dir), basename(filePath));
  }
}

export type EntryKind = "file" | "folder";

const NODE_ONLY_SCRIPT = /\.(?:[cm]?ts|tsx|jsx|cjs)$/;
const BROWSER_OR_NODE_SCRIPT = /\.m?js$/;
const isExtensionless = (name: string) => name !== "" && !name.includes(".");

/** A script only Node runs, whatever folder holds it. */
export function nodeOnlyScript(relPath: string): boolean {
  return NODE_ONLY_SCRIPT.test(foldedPath(relPath).split("/").at(-1) ?? "");
}

/**
 * A Node-only script, or below (at any depth, past the project too) a package.json that is not the scaffold's: a
 * `.js`/`.mjs` file, an extensionless file, or a file Node resolves before the module of its name plus an extension
 * beside it.
 */
export function nodeMayRun(projectDir: string, relPath: string, kind: EntryKind): boolean {
  if (nodeOnlyScript(relPath)) return true;
  const name = foldedPath(relPath).split("/").at(-1) ?? "";
  const folder = dirname(resolve(projectDir, relPath));
  const sharedWithNode =
    BROWSER_OR_NODE_SCRIPT.test(name) ||
    (kind === "file" && (isExtensionless(name) || shadowsModuleIn(folder, name)));
  if (!sharedWithNode) return false;
  return [folder, realFilePath(folder)].some((from) => foldersUp(from).some(manifestBringsNode));
}

const MODULE_EXTENSIONS = ["js", "mjs", "cjs", "jsx", "ts", "mts", "cts", "tsx", "json", "node"];

const shadowsModuleIn = (folder: string, name: string): boolean =>
  name !== "" &&
  [folder, realFilePath(folder)].some((at) => {
    const entries = foldedEntriesOf(at);
    return MODULE_EXTENSIONS.some((extension) => entries.has(`${name}.${extension}`));
  });

const folderEntryCache = new Map<string, { stat: string; names: ReadonlySet<string> }>();

function foldedEntriesOf(folder: string): ReadonlySet<string> {
  const stat = statSync(folder, { throwIfNoEntry: false });
  if (!stat?.isDirectory()) return new Set();
  const key = `${stat.ino}:${stat.mtimeMs}`;
  const cached = folderEntryCache.get(folder);
  if (cached?.stat === key) return cached.names;
  let listed: string[] = [];
  try {
    listed = readdirSync(folder);
  } catch {
    // expected: a folder that cannot be listed has no module beside the name to shadow
  }
  const names = new Set(listed.map(foldedPath));
  folderEntryCache.set(folder, { stat: key, names });
  return names;
}

function foldersUp(from: string): string[] {
  const parent = dirname(from);
  return parent === from ? [from] : [from, ...foldersUp(parent)];
}

const manifests = new Map<string, { stat: string; bringsNode: boolean }>();

function manifestBringsNode(folder: string): boolean {
  const path = join(folder, "package.json");
  const stat = statSync(path, { throwIfNoEntry: false });
  if (!stat?.isFile()) return false;
  const key = `${stat.ino}:${stat.size}:${stat.mtimeMs}`;
  const cached = manifests.get(path);
  if (cached?.stat === key) return cached.bringsNode;
  const bringsNode = !isScaffoldManifest(readPackageJson(path));
  manifests.set(path, { stat: key, bringsNode });
  return bringsNode;
}

function readPackageJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

const INERT_FIELDS = new Set(
  "name version private type description license author contributors keywords homepage repository bugs engines".split(
    " ",
  ),
);
const HYPERFRAMES_COMMAND = /^(?:npx (?:--yes |-y )?)?hyperframes(?:@[\w.+-]+)?(?: [\w@=:./+-]+)*$/;

/** A manifest with nothing but inert fields and scripts that only call the hyperframes CLI, as `hyperframes init` writes. */
function isScaffoldManifest(pkg: unknown): boolean {
  if (!pkg || typeof pkg !== "object" || Array.isArray(pkg)) return false;
  return Object.entries(pkg).every(([field, value]) =>
    field === "scripts" ? onlyHyperframesScripts(value) : INERT_FIELDS.has(field),
  );
}

function onlyHyperframesScripts(scripts: unknown): boolean {
  if (!scripts || typeof scripts !== "object" || Array.isArray(scripts)) return false;
  return Object.values(scripts).every(
    (script) =>
      typeof script === "string" &&
      script.split(" && ").every((command) => HYPERFRAMES_COMMAND.test(command.trim())),
  );
}

const foldedPath = (path: string): string =>
  projectPathSegments(path)
    .filter((segment) => segment !== "" && segment !== ".")
    .join("/");
