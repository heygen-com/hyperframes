import { accessSync, constants, existsSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, isAbsolute, join, relative, resolve, sep, win32 } from "node:path";

/**
 * The one rule for finding a helper program by name. A project folder can come from anyone, so a
 * program is taken only from an absolute PATH entry outside the working directory, or a fixed
 * install dir. Only an override the person sets in their own environment may point into it.
 */

function comparable(path: string): string {
  let full = resolve(path);
  try {
    full = realpathSync.native(full);
  } catch {
    full = resolve(path);
  }
  return process.platform === "win32" ? full.toLowerCase() : full;
}

function contains(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

/** Whether a program in `dir` may be run without the person naming it. */
export function isTrustedDirectory(dir: string): boolean {
  if (!dir || !isAbsolute(dir)) return false;
  const target = comparable(dir);
  const cwd = comparable(process.cwd());
  if (target === cwd) return false;
  // From the home folder (or above it) every per-user install dir is inside; skip only the folder.
  return contains(cwd, comparable(homedir())) || !contains(cwd, target);
}

/** Whether `file` is an absolute path in a folder {@link isTrustedDirectory} accepts. */
export function isTrustedExecutablePath(file: string): boolean {
  return isAbsolute(file) && isTrustedDirectory(dirname(file));
}

function expandHome(dir: string): string {
  if (!(dir === "~" || dir.startsWith("~/"))) return dir;
  return join(homedir(), dir.slice(1));
}

function unquoted(dir: string): string {
  return dir.length > 1 && dir.startsWith('"') && dir.endsWith('"') ? dir.slice(1, -1) : dir;
}

/** PATH entries as the program search reads them: Windows allows quotes, shells expand a leading `~`. */
export function pathEntries(
  pathValue: string,
  platform: NodeJS.Platform = process.platform,
): string[] {
  if (platform === "win32") return pathValue.split(win32.delimiter).map(unquoted);
  return pathValue.split(delimiter).map(expandHome);
}

function windowsFolderKey(dir: string): string {
  return dir.replaceAll("/", "\\").replace(/\\+$/, "").toLowerCase();
}

function windowsSystemFolders(env: NodeJS.ProcessEnv): Set<string> {
  const rootKey = Object.keys(env).find((key) => key.toUpperCase() === "SYSTEMROOT");
  const root = (rootKey && env[rootKey]) || "C:\\Windows";
  const system32 = win32.join(root, "System32");
  return new Set(
    [
      root,
      system32,
      win32.join(system32, "Wbem"),
      win32.join(system32, "WindowsPowerShell", "v1.0"),
    ].map(windowsFolderKey),
  );
}

/** The PATH folders a helper program may come from, in PATH order. Windows always keeps its system folders. */
export function trustedPathDirs(
  pathValue = process.env.PATH ?? "",
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const system = platform === "win32" ? windowsSystemFolders(env) : new Set<string>();
  const entries = pathEntries(pathValue, platform);
  return [
    ...new Set(
      entries.filter((dir) => system.has(windowsFolderKey(dir)) || isTrustedDirectory(dir)),
    ),
  ];
}

function windowsExtensions(): string[] {
  const listed = (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD")
    .split(";")
    .map((ext) => ext.trim().toLowerCase())
    .filter(Boolean);
  return [...new Set([".exe", ...listed])];
}

function isExecutableFile(file: string): boolean {
  if (process.platform === "win32") return existsSync(file);
  try {
    accessSync(file, constants.X_OK);
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

/** The program `name` in `dir`, trying the Windows program extensions there. */
export function executableIn(dir: string, name: string): string | undefined {
  const extensions = process.platform === "win32" ? windowsExtensions() : [""];
  for (const ext of extensions) {
    const candidate = join(dir, `${name}${ext}`);
    if (isExecutableFile(candidate)) return candidate;
  }
  return undefined;
}

export function findTrustedExecutable(name: string): string | undefined {
  for (const dir of trustedPathDirs()) {
    const found = executableIn(dir, name);
    if (found) return found;
  }
  return undefined;
}
