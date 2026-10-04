import * as fs from "node:fs";
import { randomBytes } from "node:crypto";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { realpath } from "./safePath.js";

type SiblingFileSystem = Pick<typeof fs, "writeFileSync" | "chmodSync" | "unlinkSync">;

// Codes a volume without hard links (FAT, exFAT, some network shares) answers link() with.
// EISDIR: libuv maps Windows ERROR_INVALID_FUNCTION (FAT/exFAT refusing a link) to it; nodejs/node#65817.
const NO_HARD_LINKS = new Set(["EPERM", "ENOTSUP", "EOPNOTSUPP", "EXDEV", "EISDIR"]);
// Windows refuses a rename while another process briefly holds the target open.
const BUSY_RENAME = new Set(["EPERM", "EBUSY", "EACCES"]);
const RENAME_RETRY_DELAYS_MS = [10, 20, 30, 40];
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

/** Replace a file only after the complete sibling temp file is written. No mode: the default one. */
export function replaceFileAtomically(
  filePath: string,
  content: string | Uint8Array,
  mode?: number,
  operations: SiblingFileSystem & Pick<typeof fs, "renameSync"> = fs,
): void {
  // Node fs.rename uses libuv uv_fs_rename; win32 calls MoveFileExW with MOVEFILE_REPLACE_EXISTING.
  publishSibling(filePath, content, mode, operations, (tempPath) =>
    renameWithRetry(operations, tempPath, filePath),
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
  const fd = fs.openSync(filePath, "wx");
  try {
    operations.writeFileSync(fd, content);
  } catch (error) {
    fs.closeSync(fd);
    try {
      operations.unlinkSync(filePath);
    } catch {
      // Preserve the write error; cleanup is best effort.
    }
    throw error;
  }
  fs.closeSync(fd);
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
      operations.writeFileSync(tempPath, content, { encoding: "utf-8", mode, flag: "wx" });
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

function renameWithRetry(
  operations: Pick<typeof fs, "renameSync">,
  from: string,
  to: string,
): void {
  for (let attempt = 0; ; attempt++) {
    try {
      operations.renameSync(from, to);
      return;
    } catch (error) {
      const delay = RENAME_RETRY_DELAYS_MS[attempt];
      if (delay === undefined || !BUSY_RENAME.has(errorCode(error))) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delay);
    }
  }
}

function errorCode(error: unknown): string {
  return String((error as NodeJS.ErrnoException)?.code);
}
