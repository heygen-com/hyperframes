import * as fs from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { realpath } from "./safePath.js";
import { renameWithRetry } from "./renameWithRetry.js";

type SiblingFileSystem = Pick<
  typeof fs,
  "openSync" | "writeFileSync" | "fsyncSync" | "closeSync" | "chmodSync" | "unlinkSync"
>;

// Codes a volume without hard links (FAT, exFAT, some network shares, Android app data) answers link() with.
// EISDIR: libuv maps Windows ERROR_INVALID_FUNCTION (FAT/exFAT refusing a link) to it; nodejs/node#65817.
const NO_HARD_LINKS = new Set(["EPERM", "ENOTSUP", "EOPNOTSUPP", "EXDEV", "EISDIR", "EACCES"]);
const MAX_LINK_HOPS = 40;
const TEMP_NAME_TRIES = 3;
const TEMP_SUFFIX = /\.hf[0-9a-f]{6}\.tmp$/;

/** A fresh temp sibling for a write that publishes `filePath`. 13 bytes, so a 242-byte name still fits. */
export function atomicTempPath(filePath: string): string {
  return `${filePath}.hf${randomBytes(3).toString("hex")}.tmp`;
}

export function isAtomicTempPath(path: string): boolean {
  return TEMP_SUFFIX.test(path);
}

/** With HF_WRITE_TRACE naming a file, one JSON line per replaced .html: its hash, size and caller. */
function traceWrite(filePath: string, content: string | Uint8Array): void {
  const out = process.env.HF_WRITE_TRACE;
  if (!out || !filePath.endsWith(".html")) return;
  const text = typeof content === "string" ? content : Buffer.from(content).toString("utf8");
  const hash = createHash("sha256").update(text).digest("hex").slice(0, 8);
  const stack = (new Error().stack ?? "")
    .split("\n")
    .slice(2, 7)
    .map((line) => line.trim());
  const file = basename(filePath);
  fs.appendFileSync(
    out,
    `${JSON.stringify({ t: Date.now(), kind: "write", file, hash, size: text.length, stack })}\n`,
  );
}

/** Replace a file only after the complete sibling temp file is written. No mode: the default one. */
export function replaceFileAtomically(
  filePath: string,
  content: string | Uint8Array,
  mode?: number,
  operations: SiblingFileSystem & Pick<typeof fs, "renameSync"> = fs,
): void {
  traceWrite(filePath, content);
  // Node fs.rename uses libuv uv_fs_rename; win32 calls MoveFileExW with MOVEFILE_REPLACE_EXISTING.
  publishSibling(filePath, content, mode, operations, (tempPath) =>
    renameWithRetry(tempPath, filePath, { rename: operations.renameSync }),
  );
}

/** Create a file that must not exist yet (EEXIST otherwise); readers never see it empty or partial. */
export function createFileAtomically(
  filePath: string,
  content: string | Uint8Array,
  operations: SiblingFileSystem & Pick<typeof fs, "linkSync"> = fs,
): void {
  publishSibling(filePath, content, undefined, operations, (tempPath) => {
    try {
      operations.linkSync(tempPath, filePath);
    } catch (error) {
      if (!NO_HARD_LINKS.has(errorCode(error))) throw error;
      createDirectly(filePath, content, operations);
    }
    try {
      operations.unlinkSync(tempPath);
    } catch (error) {
      console.warn(`[hyperframes] created ${filePath} but could not remove ${tempPath}: ${error}`);
    }
  });
}

/** Without hard links: an exclusive write; a partial file it made (a full disk) is removed, a taken name never. */
function createDirectly(
  filePath: string,
  content: string | Uint8Array,
  operations: SiblingFileSystem,
): void {
  const fd = operations.openSync(filePath, "wx");
  let open = true;
  try {
    operations.writeFileSync(fd, content);
    // The name is the file here, so its bytes must reach the disk before another run trusts it.
    operations.fsyncSync(fd);
    open = false;
    operations.closeSync(fd);
  } catch (error) {
    try {
      if (open) operations.closeSync(fd);
    } catch {
      // Preserve the write error; cleanup is best effort.
    }
    try {
      operations.unlinkSync(filePath);
    } catch {
      // Preserve the write error; cleanup is best effort.
    }
    throw error;
  }
}

/** The file a write to `filePath` lands on: folder links and file links followed as the system does. */
export function resolveWritePath(filePath: string): string {
  let path = resolve(filePath);
  for (let hop = 0; hop < MAX_LINK_HOPS; hop++) {
    try {
      return realpath(path);
    } catch (error) {
      if (errorCode(error) !== "ENOENT") throw error;
    }
    // Missing: a new file, or a dangling link to the file a write through it creates.
    const parent = realpath(dirname(path));
    const leaf = join(parent, basename(path));
    if (!fs.lstatSync(leaf, { throwIfNoEntry: false })?.isSymbolicLink()) return leaf;
    // Not normalized: `x/..` must climb out of where link `x` points, as the system reads it.
    const target = fs.readlinkSync(leaf);
    path = isAbsolute(target) ? target : `${parent}${sep}${target}`;
  }
  throw Object.assign(new Error(`ELOOP: too many symbolic links, '${filePath}'`), {
    code: "ELOOP",
  });
}

function publishSibling(
  filePath: string,
  content: string | Uint8Array,
  mode: number | undefined,
  operations: SiblingFileSystem,
  publish: (tempPath: string) => void,
): void {
  const tempPath = writeTempSibling(filePath, content, mode, operations);
  try {
    if (mode !== undefined) operations.chmodSync(tempPath, mode);
    publish(tempPath);
    syncParentDirectory(filePath, operations);
  } catch (error) {
    try {
      operations.unlinkSync(tempPath);
    } catch {
      // Preserve the write error; cleanup is best effort.
    }
    throw error;
  }
}

/** A new temp file beside `filePath`; a name another writer already holds is never touched. */
function writeTempSibling(
  filePath: string,
  content: string | Uint8Array,
  mode: number | undefined,
  operations: SiblingFileSystem,
): string {
  for (let attempt = 1; ; attempt++) {
    const tempPath = atomicTempPath(filePath);
    try {
      writeAndSyncTempFile(tempPath, content, mode, operations);
      return tempPath;
    } catch (error) {
      if (errorCode(error) === "EEXIST") {
        if (attempt < TEMP_NAME_TRIES) continue;
        throw error;
      }
      try {
        operations.unlinkSync(tempPath);
      } catch {
        // Preserve the write error; cleanup is best effort.
      }
      throw error;
    }
  }
}

/**
 * Writes the temp file and forces its bytes to the disk, so the rename that publishes the name can never
 * outrun the data: a power cut before the rename leaves only an unreferenced temp, never a NUL-filled target.
 */
function writeAndSyncTempFile(
  tempPath: string,
  content: string | Uint8Array,
  mode: number | undefined,
  operations: SiblingFileSystem,
): void {
  const fd = operations.openSync(tempPath, "wx", mode);
  let failure: unknown;
  try {
    operations.writeFileSync(fd, content, { encoding: "utf-8" });
    operations.fsyncSync(fd);
  } catch (error) {
    failure = error;
  }
  try {
    operations.closeSync(fd);
  } catch (error) {
    // A close that reports the disk's quota (EDQUOT) is a failed write; a write error already found is the clearer one.
    failure ??= error;
  }
  if (failure) throw failure;
}

/**
 * Forces the rename itself to the disk. Windows refuses to open a directory for fsync, and some network
 * filesystems do too; there the rename stays atomic, it just may not survive a power cut. Best effort
 * because the bytes are already published: a failed directory sync must not report the write as failed.
 */
function syncParentDirectory(filePath: string, operations: SiblingFileSystem): void {
  if (process.platform === "win32") return;
  let fd: number | undefined;
  try {
    fd = operations.openSync(dirname(filePath), "r");
    operations.fsyncSync(fd);
  } catch {
    // Not every filesystem supports fsync on a directory.
  } finally {
    if (fd !== undefined) {
      try {
        operations.closeSync(fd);
      } catch {
        // The bytes and the name are on disk; a close error here cannot undo that.
      }
    }
  }
}

function errorCode(error: unknown): string {
  return String((error as NodeJS.ErrnoException)?.code);
}

const WIN32_LONG_PREFIX = "\\\\?\\";
const WIN32_ABSOLUTE = /^([A-Za-z]:\\|\\\\)/;
const WIN32_DOS_DEVICE = /^\\\\[.?]\\/;

function toWin32LongPath(path: string): string {
  const full = resolve(path);
  if (!WIN32_ABSOLUTE.test(full) || WIN32_DOS_DEVICE.test(full)) return path;
  return full.startsWith("\\\\")
    ? `${WIN32_LONG_PREFIX}UNC\\${full.slice(2)}`
    : `${WIN32_LONG_PREFIX}${full}`;
}

/** `prefix` + 6 random characters in `parent`, made private; Windows past 260 characters needs the long path. */
export function createStagingDir(parent: string, prefix: string): string {
  const requested = join(parent, prefix);
  const long = toWin32LongPath(requested);
  const created = fs.mkdtempSync(long);
  return long === requested ? created : withoutAddedLongPrefix(created);
}

function withoutAddedLongPrefix(path: string): string {
  const unc = `${WIN32_LONG_PREFIX}UNC\\`;
  return path.startsWith(unc)
    ? `\\\\${path.slice(unc.length)}`
    : path.slice(WIN32_LONG_PREFIX.length);
}
