import { lstatSync, mkdirSync, renameSync, rmdirSync, rmSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { atomicTempPath } from "@hyperframes/core/atomic-file";
import { realpath, realProjectRoot } from "@hyperframes/core/safe-path";
import { inTheWay } from "./historyRefused.js";

const DRIVE = /^[a-z]:/i;

/** The name as Windows reads it, without its trailing dots and spaces (a scan, so a long run of them stays cheap). */
function withoutTrailingDotsAndSpaces(name: string): string {
  let end = name.length;
  while (end > 0 && (name[end - 1] === "." || name[end - 1] === " ")) end -= 1;
  return name.slice(0, end);
}

const isPlainName = (name: string) =>
  withoutTrailingDotsAndSpaces(name) !== "" &&
  !DRIVE.test(name) &&
  !(process.platform === "win32" && name.includes(":"));

/** Relative, `/`-separated, and no `\`, drive, empty, `.` or `..` segment, as Windows reads it too (`.. ` is `..`). */
export function isRelativeProjectPath(path: string): boolean {
  return !path.includes("\\") && path.split("/").every(isPlainName);
}

const changedWhileWriting = (folder: string) =>
  new Error(`${folder} changed while history was writing to it, so it stopped.`);

/** The real folder for `path` under `root`, walked folder by folder with no link; null when missing and not `make`. */
export function folderWithin(root: string, path: string, make: boolean): string | null {
  if (!isRelativeProjectPath(path)) throw new Error(`${path} is not a path inside the project.`);
  let folder = realProjectRoot(root);
  const names = path.split("/").slice(0, -1);
  for (const [depth, name] of names.entries()) {
    const next = join(folder, name);
    let made = false;
    if (!lstatSync(next, { throwIfNoEntry: false })) {
      if (!make) return null;
      made = makeFolder(next);
    }
    const real = lstatSync(next, { throwIfNoEntry: false })?.isDirectory()
      ? realpath(next)
      : undefined;
    if (real === undefined || dirname(real) !== folder) {
      if (made) rmdirSync(next);
      throw inTheWay(names.slice(0, depth + 1).join("/"));
    }
    folder = real;
  }
  return folder;
}

function makeFolder(path: string): boolean {
  try {
    mkdirSync(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    return false;
  }
}

export function assertStillWithin(folder: string): void {
  let real: string | undefined;
  try {
    real = realpath(folder);
  } catch {
    real = undefined;
  }
  if (real !== folder) throw changedWhileWriting(folder);
}

export function assertLandedIn(folder: string, path: string): void {
  assertStillWithin(folder);
  if (dirname(path) !== folder || !lstatSync(path, { throwIfNoEntry: false })?.isFile())
    throw changedWhileWriting(folder);
}

/** Renames the file aside in its own folder, checks it stayed in `folder`, then lets `keep` take it and removes it. */
export async function removeWithin(
  folder: string,
  path: string,
  keep?: (aside: string) => Promise<void>,
): Promise<void> {
  const at = join(folder, basename(path));
  const standing = lstatSync(at, { throwIfNoEntry: false });
  if (!standing) return;
  if (standing.isDirectory()) throw inTheWay(path);
  const aside = atomicTempPath(at);
  assertStillWithin(folder);
  try {
    renameSync(at, aside);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  try {
    assertLandedIn(folder, aside);
    await keep?.(aside);
  } catch (error) {
    try {
      renameSync(aside, at);
    } catch {
      // The error that brought it here says why.
    }
    throw error;
  }
  rmSync(aside, { force: true });
}
