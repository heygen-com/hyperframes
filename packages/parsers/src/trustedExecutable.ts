import { accessSync, constants, existsSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, delimiter, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

/**
 * The one rule for finding a helper program by name. A project can come from anyone, so a program
 * is taken only from an absolute PATH entry outside the working directory and its project, or a
 * fixed install dir. Only an override the person sets in their own environment may point into it.
 */

function comparable(path: string): string {
  const full = resolve(path);
  const missing: string[] = [];
  for (let dir = full; ; dir = dirname(dir)) {
    try {
      const real = join(realpathSync.native(dir), ...missing.reverse());
      return process.platform === "win32" ? real.toLowerCase() : real;
    } catch {
      if (dirname(dir) === dir) return process.platform === "win32" ? full.toLowerCase() : full;
      missing.push(basename(dir));
    }
  }
}

function contains(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

const PROJECT_MARKERS = ["package.json", ".git"];

// Package runners put every ancestor's node_modules/.bin on PATH. Home and above are never the project.
function projectFoldersAbove(cwd: string, home: string): string[] {
  const folders: string[] = [];
  let outermost: string | undefined;
  for (let dir = dirname(cwd); ; dir = dirname(dir)) {
    folders.push(comparable(join(dir, "node_modules")));
    const isRoot = dirname(dir) === dir;
    if (isRoot) break;
    const belowHome = !contains(dir, home);
    if (belowHome && PROJECT_MARKERS.some((marker) => existsSync(join(dir, marker)))) {
      outermost = dir;
    }
  }
  return outermost ? [...folders, outermost] : folders;
}

function trustRule(): (dir: string) => boolean {
  const cwd = comparable(process.cwd());
  const home = comparable(homedir());
  const above = projectFoldersAbove(cwd, home);
  // From the home folder (or above it) every per-user install dir is inside; skip only the folder.
  const fromHome = contains(cwd, home);
  return (dir) => {
    if (!dir || !isAbsolute(dir)) return false;
    const target = comparable(dir);
    if (target === cwd) return false;
    if (above.some((folder) => contains(folder, target))) return false;
    return fromHome || !contains(cwd, target);
  };
}

/** Whether a program in `dir` may be run without the person naming it. */
export function isTrustedDirectory(dir: string): boolean {
  return trustRule()(dir);
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
  const trusted = trustRule();
  return [...new Set(entries.filter((dir) => trusted(dir)))];
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
