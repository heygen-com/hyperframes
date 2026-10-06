import { closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, readSync } from "node:fs";
import { join } from "node:path";
import { replaceFileAtomically } from "@hyperframes/core/atomic-file";

// The records the CLI and the desktop app keep in a project's .hyperframes/. A project can be a clone of someone
// else's repo, so a link in place of the folder or of a record is never followed, on reading or on writing.
const NO_FOLLOW = constants.O_NOFOLLOW ?? 0;
const NON_BLOCK = constants.O_NONBLOCK ?? 0;

/** The folder, made when missing and asked for; null when something other than a real folder holds its name. */
function recordsDir(projectDir: string, create = false): string | null {
  const dir = join(projectDir, ".hyperframes");
  try {
    return lstatSync(dir).isDirectory() ? dir : null;
  } catch {
    if (!create) return null;
    try {
      mkdirSync(dir);
      return dir;
    } catch {
      return null;
    }
  }
}

/** The last `maxBytes` of a plain file; "" for a link, a device, or a missing file. The file is opened once and
 * must be the one `lstat` saw, so this holds where O_NOFOLLOW doesn't exist (Windows). */
export function readPlainFile(path: string, maxBytes: number): string {
  let seen;
  let fd: number;
  try {
    seen = lstatSync(path);
    if (!seen.isFile()) return "";
    fd = openSync(path, constants.O_RDONLY | NO_FOLLOW | NON_BLOCK);
  } catch {
    return "";
  }
  try {
    const stats = fstatSync(fd);
    if (!stats.isFile() || stats.ino !== seen.ino || stats.dev !== seen.dev) return "";
    const length = Math.min(stats.size, maxBytes);
    const buffer = Buffer.alloc(length);
    readSync(fd, buffer, 0, length, stats.size - length);
    return buffer.toString("utf8");
  } finally {
    closeSync(fd);
  }
}

export function readRecord(projectDir: string, name: string, maxBytes: number): string {
  const dir = recordsDir(projectDir);
  return dir ? readPlainFile(join(dir, name), maxBytes) : "";
}

/** When a record last changed; 0 when it is missing or not a plain file. */
export function recordChangedAt(projectDir: string, name: string): number {
  const dir = recordsDir(projectDir);
  try {
    const stats = dir ? lstatSync(join(dir, name)) : null;
    return stats?.isFile() ? stats.mtimeMs : 0;
  } catch {
    return 0;
  }
}

/** A file written whole through a temp file renamed over it, so a link in its place is replaced, never written
 * through, and a crash mid-write leaves the old file. False when it could not be written. */
export function replaceFile(path: string, data: string, mode: number): boolean {
  try {
    replaceFileAtomically(path, data, mode);
    return true;
  } catch {
    return false;
  }
}

/** A record written whole and owner-only, in a real .hyperframes folder. */
export function writeRecord(projectDir: string, name: string, data: string): boolean {
  const dir = recordsDir(projectDir, true);
  return dir !== null && replaceFile(join(dir, name), data, 0o600);
}
