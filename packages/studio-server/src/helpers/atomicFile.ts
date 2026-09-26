import * as fs from "node:fs";
import { randomUUID } from "node:crypto";
import { basename, dirname, join } from "node:path";

type AtomicFileSystem = Pick<
  typeof fs,
  "writeFileSync" | "chmodSync" | "renameSync" | "unlinkSync"
>;

/** Replace a file only after the complete sibling temp file is written; a symlink's target is replaced unless followLinks is false. */
export function replaceFileAtomically(
  filePath: string,
  content: string | Uint8Array,
  mode: number,
  operations: AtomicFileSystem = fs,
  { followLinks = true }: { followLinks?: boolean } = {},
): void {
  const target = followLinks ? realFilePath(filePath) : filePath;
  const tempPath = `${target}.${process.pid}.${randomUUID()}.tmp`;
  try {
    operations.writeFileSync(tempPath, content, { encoding: "utf-8", mode });
    operations.chmodSync(tempPath, mode);
    // Node fs.rename uses libuv uv_fs_rename; win32 calls MoveFileExW with MOVEFILE_REPLACE_EXISTING.
    operations.renameSync(tempPath, target);
  } catch (error) {
    try {
      operations.unlinkSync(tempPath);
    } catch {
      // Preserve the write error; cleanup is best effort.
    }
    throw error;
  }
}

/** The file's real path; for a path not there (yet, or any more), the nearest existing folder's real path joined with the rest. */
export function realFilePath(filePath: string): string {
  try {
    return fs.realpathSync(filePath);
  } catch {
    const dir = dirname(filePath);
    return dir === filePath ? filePath : join(realFilePath(dir), basename(filePath));
  }
}
