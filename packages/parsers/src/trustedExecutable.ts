import { execFileSync } from "node:child_process";
import { accessSync, constants, existsSync, realpathSync } from "node:fs";
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

/** The PATH folders a helper program may come from, in PATH order. */
export function trustedPathDirs(pathValue = process.env.PATH ?? ""): string[] {
  const entries = pathValue.split(delimiter);
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
    return true;
  } catch {
    return false;
  }
}

function scanTrustedPath(name: string): string | undefined {
  const extensions = process.platform === "win32" ? windowsExtensions() : [""];
  for (const dir of trustedPathDirs()) {
    for (const ext of extensions) {
      const candidate = join(dir, `${name}${ext}`);
      if (isExecutableFile(candidate)) return candidate;
    }
  }
  return undefined;
}

/** Windows walks PATH itself: `where` lists the working directory first. Elsewhere `which`
 * answers, and an untrusted first hit falls through to the PATH walk. */
export function findTrustedExecutable(name: string): string | undefined {
  if (process.platform === "win32") return scanTrustedPath(name);
  let listed: string | undefined;
  try {
    listed = execFileSync("which", [name], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5000,
    })
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean);
  } catch {
    return undefined;
  }
  if (!listed) return undefined;
  return isTrustedExecutablePath(listed) ? listed : scanTrustedPath(name);
}
