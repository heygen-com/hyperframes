import { accessSync, constants, existsSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

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
  if (process.platform === "win32" || !(dir === "~" || dir.startsWith("~/"))) return dir;
  return join(homedir(), dir.slice(1));
}

/** The PATH folders a helper program may come from, in PATH order. */
export function trustedPathDirs(pathValue = process.env.PATH ?? ""): string[] {
  const entries = pathValue.split(delimiter).map(expandHome);
  return [...new Set(entries.filter((dir) => isTrustedDirectory(dir)))];
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

export function findTrustedExecutable(name: string): string | undefined {
  const extensions = process.platform === "win32" ? windowsExtensions() : [""];
  for (const dir of trustedPathDirs()) {
    for (const ext of extensions) {
      const candidate = join(dir, `${name}${ext}`);
      if (isExecutableFile(candidate)) return candidate;
    }
  }
  return undefined;
}
