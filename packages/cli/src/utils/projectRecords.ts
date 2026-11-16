import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";
import { replaceFileAtomically } from "@hyperframes/core/atomic-file";

// The records the CLI and the desktop app keep in a project's .hyperframes/. A project can be a clone of someone
// else's repo, so a link in place of the folder or of a record is never followed, on reading or on writing.
const NO_FOLLOW = constants.O_NOFOLLOW ?? 0;
const NON_BLOCK = constants.O_NONBLOCK ?? 0;

/** A record's folder, each level made if asked; null when anything but a real folder holds a level's name. */
function recordsDir(projectDir: string, name: string, create = false): string | null {
  let dir = projectDir;
  for (const part of [".hyperframes", ...name.split("/").slice(0, -1)]) {
    dir = join(dir, part);
    try {
      if (!lstatSync(dir).isDirectory()) return null;
    } catch {
      if (!create) return null;
      try {
        mkdirSync(dir);
      } catch {
        return null;
      }
    }
  }
  return dir;
}

const recordFile = (name: string) => name.split("/").at(-1) ?? name;

/** The last `maxBytes` of a plain file, and whether that is all of it; null for a link, a device, or a missing file.
 * The file is opened first and read only when `lstat` then finds the same plain file at the path, so this holds
 * where O_NOFOLLOW doesn't exist (Windows), and nothing path-based follows the check. */
function readPlainTail(path: string, maxBytes: number): { text: string; whole: boolean } | null {
  let fd: number;
  try {
    fd = openSync(path, constants.O_RDONLY | NO_FOLLOW | NON_BLOCK);
  } catch {
    return null;
  }
  try {
    const stats = fstatSync(fd);
    const named = lstatSync(path);
    if (!stats.isFile() || !named.isFile() || named.ino !== stats.ino || named.dev !== stats.dev)
      return null;
    const length = Math.min(stats.size, maxBytes);
    const buffer = Buffer.alloc(length);
    readSync(fd, buffer, 0, length, stats.size - length);
    return { text: buffer.toString("utf8"), whole: length === stats.size };
  } catch {
    return null;
  } finally {
    closeSync(fd);
  }
}

export function readPlainFile(path: string, maxBytes: number): string {
  return readPlainTail(path, maxBytes)?.text ?? "";
}

export function readRecordTail(
  projectDir: string,
  name: string,
  maxBytes: number,
): { text: string; whole: boolean } | null {
  const dir = recordsDir(projectDir, name);
  return dir ? readPlainTail(join(dir, recordFile(name)), maxBytes) : null;
}

export function readRecord(projectDir: string, name: string, maxBytes: number): string {
  return readRecordTail(projectDir, name, maxBytes)?.text ?? "";
}

/** When a record last changed; 0 when it is missing or not a plain file. */
export function recordChangedAt(projectDir: string, name: string): number {
  const dir = recordsDir(projectDir, name);
  try {
    const stats = dir ? lstatSync(join(dir, recordFile(name))) : null;
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

/** A record written whole and owner-only, in real folders all the way from .hyperframes. */
export function writeRecord(projectDir: string, name: string, data: string): boolean {
  const dir = recordsDir(projectDir, name, true);
  return dir !== null && replaceFile(join(dir, recordFile(name)), data, 0o600);
}

export function recordFolder(projectDir: string, folder: string): string | null {
  return recordsDir(projectDir, `${folder.replaceAll("\\", "/")}/`, true);
}

/** Deletes a record that is a plain file; false when there is none to delete. */
export function removeRecord(projectDir: string, name: string): boolean {
  const dir = recordsDir(projectDir, name);
  try {
    if (!dir || !lstatSync(join(dir, recordFile(name))).isFile()) return false;
    unlinkSync(join(dir, recordFile(name)));
    return true;
  } catch {
    return false;
  }
}
