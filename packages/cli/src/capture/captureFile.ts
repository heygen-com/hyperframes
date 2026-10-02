import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { CaptureDirRefusedError } from "./captureErrors.js";

type WriteOptions = Parameters<typeof writeFileSync>[2];

// Writes are staged in a private directory next to the target and renamed over
// it, the same publication pattern as the producer's font cache (#3669).
// `rename` replaces the directory entry itself, so a symlink or hard link
// pre-planted at the target is swapped out instead of written through, while
// intentional overwrites (the deadline partial bundle rewriting files from the
// in-progress attempt) keep working. The staging directory is created fresh by
// this call, so nothing in it can be pre-planted and cleanup only ever removes
// what this call made.
function publishCaptureFileSync(
  path: string,
  data: string | NodeJS.ArrayBufferView,
  options: Exclude<WriteOptions, string>,
): void {
  const stagingDir = mkdtempSync(join(dirname(path), ".capture-"));
  try {
    const staged = join(stagingDir, basename(path));
    writeCaptureFileSync(staged, data, { ...options, flag: "wx" });
    renameSync(staged, path);
  } finally {
    rmSync(stagingDir, { recursive: true, force: true });
  }
}

// A caller that passes its own flag keeps those semantics. Exclusive create
// (`wx`) is already safe on its own: O_EXCL refuses anything at the target,
// symlinks included.
export function writeCaptureFileSync(
  path: string,
  data: string | NodeJS.ArrayBufferView,
  options?: WriteOptions,
): void {
  const normalized = typeof options === "string" ? { encoding: options } : options;
  if (normalized?.flag === undefined || normalized.flag === "w") {
    return publishCaptureFileSync(path, data, normalized);
  }
  writeFileSync(path, data, { ...normalized, mode: 0o600 });
}

function hasCode(error: unknown, ...codes: string[]): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    typeof error.code === "string" &&
    codes.includes(error.code)
  );
}

// The JS `realpathSync`, deliberately not `realpathSync.native`: native returns the on-disk case
// on macOS/Windows, so an existing `Assets/` asked for as `assets` would be falsely refused. The
// JS walk only rewrites the components that are links, which is exactly what is being checked.
function resolvedPath(path: string): string | undefined {
  try {
    return realpathSync(path);
  } catch (error) {
    // A dangling or looping link resolves nowhere: refuse it like any other escaping link.
    if (hasCode(error, "ENOENT", "ELOOP")) return undefined;
    throw error;
  }
}

// Creates `dir` under the trusted capture root, refusing any directory whose real path leaves it (#4304).
// Checked on creation, not on every write: a link swapped in later by a racing process is out of scope.
export function ensureCaptureDirSync(root: string, dir: string): string {
  const rootPath = resolve(root);
  const target = resolve(dir);
  const rel = relative(rootPath, target);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new CaptureDirRefusedError(
      `Refusing to create ${target}: it is outside the capture directory ${rootPath}`,
    );
  }
  mkdirSync(rootPath, { recursive: true });
  let current = rootPath;
  let expected = realpathSync(rootPath);
  for (const segment of rel.split(sep).filter(Boolean)) {
    current = join(current, segment);
    expected = join(expected, segment);
    try {
      mkdirSync(current);
    } catch (error) {
      if (!hasCode(error, "EEXIST")) throw error;
    }
    if (resolvedPath(current) !== expected) {
      throw new CaptureDirRefusedError(
        `Refusing to write into ${current}: it resolves outside the capture directory ${rootPath}`,
      );
    }
    if (!statSync(current).isDirectory()) {
      throw new CaptureDirRefusedError(`Refusing to write into ${current}: it is not a directory`);
    }
  }
  return target;
}
