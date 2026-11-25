/**
 * Folders and appends for figma's project writes that never follow a link out
 * of the project. Whole-file rewrites use `replaceFileAtomically`, whose rename
 * replaces a link instead of writing through it.
 */

import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  realpathSync,
  statSync,
  writeSync,
} from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

function leadsOutside(dir: string): Error {
  return new Error(`${dir} leads outside the project folder; nothing was written there`);
}

/**
 * Creates `dir` under `projectDir` one folder at a time and returns it. Throws
 * when any folder on the way is a link or not a folder.
 */
export function ownProjectDir(projectDir: string, dir: string): string {
  const root = resolve(projectDir);
  const target = resolve(dir);
  const rel = relative(root, target);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw leadsOutside(target);
  mkdirSync(root, { recursive: true });
  let current = root;
  // The JS realpathSync, not .native: it keeps the case asked for, as `expected` does.
  let expected = realpathSync(root);
  for (const segment of rel.split(sep).filter(Boolean)) {
    current = join(current, segment);
    expected = join(expected, segment);
    try {
      mkdirSync(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    if (lstatSync(current).isSymbolicLink() || realpathSync(current) !== expected) {
      throw leadsOutside(current);
    }
    if (!statSync(current).isDirectory()) {
      throw new Error(`${current} is not a folder; nothing was written there`);
    }
  }
  return target;
}

function notPlainFile(path: string): Error {
  return new Error(`${path} is a link or not a plain file; nothing was written through it`);
}

/**
 * Throws on a link at `path` instead of appending through it. Opened first, then
 * written only when `lstat` finds the same single-link plain file at the path, as
 * projectRecords' appendRecord does; O_NOFOLLOW is undefined on Windows.
 */
export function appendWithoutFollowing(path: string, text: string): void {
  let fd: number;
  try {
    fd = openSync(
      path,
      constants.O_WRONLY |
        constants.O_APPEND |
        constants.O_CREAT |
        (constants.O_NOFOLLOW ?? 0) |
        (constants.O_NONBLOCK ?? 0),
      0o666,
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ELOOP") throw notPlainFile(path);
    throw error;
  }
  try {
    const opened = fstatSync(fd);
    const named = lstatSync(path);
    const samePlainFile =
      opened.isFile() &&
      named.isFile() &&
      opened.nlink === 1 &&
      named.ino === opened.ino &&
      named.dev === opened.dev;
    if (!samePlainFile) throw notPlainFile(path);
    writeSync(fd, text);
  } finally {
    closeSync(fd);
  }
}
