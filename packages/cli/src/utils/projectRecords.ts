import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readSync,
  unlinkSync,
} from "node:fs";
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

/** The last `maxBytes` of a plain file, where they start, its size, and which file it is ("dev:ino"). */
export interface PlainBytes {
  bytes: Buffer;
  start: number;
  size: number;
  file: string;
}

/** The last `maxBytes` of a plain file; null for a link, a device, or a missing file. The file is opened first and
 * read only when `lstat` then finds the same plain file at the path, so this holds where O_NOFOLLOW doesn't exist
 * (Windows), and nothing path-based follows the check. */
function readPlainBytes(path: string, maxBytes: number): PlainBytes | null {
  let fd: number;
  try {
    fd = openSync(path, constants.O_RDONLY | NO_FOLLOW | NON_BLOCK);
  } catch {
    return null;
  }
  try {
    const stats = fstatSync(fd, { bigint: true });
    const named = lstatSync(path, { bigint: true });
    if (!stats.isFile() || !named.isFile() || named.ino !== stats.ino || named.dev !== stats.dev)
      return null;
    const size = Number(stats.size);
    const start = Math.max(0, size - maxBytes);
    const bytes = Buffer.alloc(size - start);
    readSync(fd, bytes, 0, bytes.length, start);
    return { bytes, start, size, file: `${stats.dev}:${stats.ino}` };
  } catch {
    return null;
  } finally {
    closeSync(fd);
  }
}

/** The last `maxBytes` of a plain file; "" for a link, a device, or a missing file. */
export function readPlainFile(path: string, maxBytes: number): string {
  return readPlainBytes(path, maxBytes)?.bytes.toString("utf8") ?? "";
}

export function readRecord(projectDir: string, name: string, maxBytes: number): string {
  return readRecordBytes(projectDir, name, maxBytes)?.bytes.toString("utf8") ?? "";
}

export function readRecordBytes(
  projectDir: string,
  name: string,
  maxBytes: number,
): PlainBytes | null {
  const dir = recordsDir(projectDir);
  return dir ? readPlainBytes(join(dir, name), maxBytes) : null;
}

/** Which file ("dev:ino") each record with one name holds, by name; empty without a real .hyperframes folder. */
export function recordFiles(projectDir: string): Map<string, string> {
  const dir = recordsDir(projectDir);
  const files = new Map<string, string>();
  if (!dir) return files;
  try {
    for (const name of readdirSync(dir)) {
      const stats = lstatSync(join(dir, name), { bigint: true });
      if (stats.isFile() && stats.nlink === 1n) files.set(name, `${stats.dev}:${stats.ino}`);
    }
  } catch {
    // A folder or record gone mid-read: what was listed is all there is.
  }
  return files;
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

/** Deletes a record that is a plain file; false when there is none to delete. */
export function removeRecord(projectDir: string, name: string): boolean {
  const dir = recordsDir(projectDir);
  try {
    if (!dir || !lstatSync(join(dir, name)).isFile()) return false;
    unlinkSync(join(dir, name));
    return true;
  } catch {
    return false;
  }
}
