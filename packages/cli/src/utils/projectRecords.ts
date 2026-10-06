import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";

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

/** The last `maxBytes` of a record; "" when it is missing, a link, or not a plain file. */
export function readRecord(projectDir: string, name: string, maxBytes: number): string {
  const dir = recordsDir(projectDir);
  if (!dir) return "";
  let fd: number;
  try {
    fd = openSync(join(dir, name), constants.O_RDONLY | NO_FOLLOW | NON_BLOCK);
  } catch {
    return "";
  }
  try {
    const stats = fstatSync(fd);
    if (!stats.isFile()) return "";
    const length = Math.min(stats.size, maxBytes);
    const buffer = Buffer.alloc(length);
    readSync(fd, buffer, 0, length, stats.size - length);
    return buffer.toString("utf8");
  } finally {
    closeSync(fd);
  }
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

/** A record written whole, owner-only: a temp file renamed over it, so a link in its place is replaced, never
 * written through, and a crash mid-write leaves the old record. False when it could not be written. */
export function writeRecord(projectDir: string, name: string, data: string): boolean {
  const dir = recordsDir(projectDir, true);
  if (!dir) return false;
  const temp = join(dir, `.${name}.${process.pid}.${randomBytes(4).toString("hex")}`);
  try {
    writeFileSync(temp, data, { mode: 0o600, flag: "wx" });
    renameSync(temp, join(dir, name));
    return true;
  } catch {
    rmSync(temp, { force: true });
    return false;
  }
}
