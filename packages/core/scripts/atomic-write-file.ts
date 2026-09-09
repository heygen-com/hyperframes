import { randomUUID } from "node:crypto";
import { renameSync, rmSync, writeFileSync, type WriteFileOptions } from "node:fs";
import { basename, dirname, join } from "node:path";

export function atomicWriteFileSync(
  destination: string,
  contents: string | NodeJS.ArrayBufferView,
  options?: WriteFileOptions,
): void {
  const temporaryPath = join(
    dirname(destination),
    `.${basename(destination)}.${process.pid}.${randomUUID()}.tmp`,
  );

  try {
    writeFileSync(temporaryPath, contents, options);
    renameSync(temporaryPath, destination);
  } catch (error) {
    rmSync(temporaryPath, { force: true });
    throw error;
  }
}
