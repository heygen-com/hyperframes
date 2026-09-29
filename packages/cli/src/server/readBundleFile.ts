import { openSync, fstatSync, closeSync, statSync, readFileSync, constants } from "node:fs";

export function readBundleFile(filePath: string): Buffer<ArrayBuffer> | null {
  let fd: number;
  try {
    // Check named pipes without waiting for a writer to connect.
    fd = openSync(filePath, constants.O_RDONLY | constants.O_NONBLOCK);
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error.code === "ENOENT" || error.code === "ENOTDIR")
    )
      return null;
    // Classify platform-specific directory/socket errors after a failed open.
    // No pathname read follows this check.
    if (!statSync(filePath, { throwIfNoEntry: false })?.isFile()) return null;
    throw error;
  }
  try {
    if (!fstatSync(fd).isFile()) return null;
    return readFileSync(fd);
  } finally {
    closeSync(fd);
  }
}
