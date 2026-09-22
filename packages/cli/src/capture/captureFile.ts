import { mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

// Writes are staged in a private directory next to the target and renamed over
// it, the same publication pattern as the producer's font cache (#3669).
// `rename` replaces the directory entry itself, so a symlink or hard link
// pre-planted at the target is swapped out instead of written through, while
// intentional overwrites (the deadline partial bundle rewriting files from the
// in-progress attempt) keep working. The staging directory is created fresh by
// this call, so nothing in it can be pre-planted and cleanup only ever removes
// what this call made.
//
// A caller that passes its own flag keeps those semantics. Exclusive create
// (`wx`) is already safe on its own: O_EXCL refuses anything at the target,
// symlinks included.
export function writeCaptureFileSync(
  path: string,
  data: string | NodeJS.ArrayBufferView,
  options?: Parameters<typeof writeFileSync>[2],
): void {
  const normalized = typeof options === "string" ? { encoding: options } : options;
  if (normalized?.flag !== undefined && normalized.flag !== "w") {
    writeFileSync(path, data, { ...normalized, mode: 0o600 });
    return;
  }

  let stagingDir: string | undefined;
  try {
    stagingDir = mkdtempSync(join(dirname(path), ".capture-"));
    const stagedPath = join(stagingDir, basename(path));
    writeFileSync(stagedPath, data, { ...normalized, mode: 0o600 });
    renameSync(stagedPath, path);
  } finally {
    if (stagingDir) rmSync(stagingDir, { recursive: true, force: true });
  }
}
