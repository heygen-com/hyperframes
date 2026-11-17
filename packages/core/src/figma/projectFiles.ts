/**
 * Folders and appends for figma's project writes that never follow a link out
 * of the project. Whole-file rewrites use `replaceFileAtomically`, whose rename
 * replaces a link instead of writing through it.
 */

import {
  closeSync,
  constants,
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

/** Throws on a link at `path` instead of appending through it. */
export function appendWithoutFollowing(path: string, text: string): void {
  if (lstatSync(path, { throwIfNoEntry: false })?.isSymbolicLink()) {
    throw new Error(`${path} is a link; nothing was written through it`);
  }
  // O_NOFOLLOW is undefined on Windows; the lstat above covers it there.
  const fd = openSync(
    path,
    constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | (constants.O_NOFOLLOW ?? 0),
    0o666,
  );
  try {
    writeSync(fd, text);
  } finally {
    closeSync(fd);
  }
}
