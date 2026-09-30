import * as fs from "node:fs";
import { randomBytes } from "node:crypto";
import { basename, dirname, join, resolve } from "node:path";
import { realpath } from "./safePath.js";

type SiblingFileSystem = Pick<typeof fs, "writeFileSync" | "chmodSync" | "unlinkSync">;

// Codes a volume without hard links (FAT, exFAT, some network shares) answers link() with.
const NO_HARD_LINKS = new Set(["EPERM", "ENOTSUP", "EOPNOTSUPP", "EXDEV"]);
// Windows refuses a rename while another process briefly holds the target open.
const BUSY_RENAME = new Set(["EPERM", "EBUSY", "EACCES"]);
const RENAME_RETRY_DELAYS_MS = [10, 20, 30, 40];
const MAX_LINK_HOPS = 40;

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
      // Without hard links, keep today's direct exclusive write.
      operations.writeFileSync(filePath, content, { flag: "wx" });
    }
    try {
      operations.unlinkSync(tempPath);
    } catch (error) {
      console.warn(`[hyperframes] created ${filePath} but could not remove ${tempPath}: ${error}`);
    }
  });
}

/** The file a write to `filePath` lands on: folder links and file links followed as the system does. */
export function resolveWritePath(filePath: string): string {
  let path = resolve(filePath);
  for (let hop = 0; hop < MAX_LINK_HOPS; hop++) {
    const real = join(realpath(dirname(path)), basename(path));
    if (!fs.lstatSync(real, { throwIfNoEntry: false })?.isSymbolicLink()) return real;
    // A dangling link resolves to the file a write through it creates.
    path = resolve(dirname(real), fs.readlinkSync(real));
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
  // Short, so a name near the filesystem's limit still fits.
  const tempPath = `${filePath}.${randomBytes(4).toString("hex")}.tmp`;
  try {
    operations.writeFileSync(tempPath, content, { encoding: "utf-8", mode, flag: "wx" });
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
