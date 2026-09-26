import * as fs from "node:fs";
import { randomUUID } from "node:crypto";

type AtomicFileSystem = Pick<
  typeof fs,
  "writeFileSync" | "chmodSync" | "renameSync" | "unlinkSync"
>;

/** Replace a file only after the complete sibling temp file is written. */
export function replaceFileAtomically(
  filePath: string,
  content: string | Uint8Array,
  mode: number,
  operations: AtomicFileSystem = fs,
): void {
  const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    operations.writeFileSync(tempPath, content, { encoding: "utf-8", mode });
    operations.chmodSync(tempPath, mode);
    // Node fs.rename uses libuv uv_fs_rename; win32 calls MoveFileExW with MOVEFILE_REPLACE_EXISTING.
    operations.renameSync(tempPath, filePath);
  } catch (error) {
    try {
      operations.unlinkSync(tempPath);
    } catch {
      // Preserve the write error; cleanup is best effort.
    }
    throw error;
  }
}
