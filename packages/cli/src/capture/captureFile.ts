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

function isAlreadyThere(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "EEXIST";
}

/**
 * Creates `dir` inside the capture output root and returns it, refusing any directory whose real
 * path is not the one it has under the root (#4304). `writeCaptureFileSync` only guards the last
 * path entry; a directory in the path that is itself a planted symlink (`assets -> ~/somewhere`)
 * would carry the staging directory and the rename, and so a filename the captured page chose,
 * into wherever it points.
 *
 * The root is the user's own choice and is trusted as given, symlink included (`/tmp` on macOS is
 * one). Everything below it is walked one level at a time, so a planted link is caught before
 * anything is created inside its target. The check runs when a directory is created, not on every
 * write: a link swapped in afterwards by a process racing the capture is beyond what it can stop.
 */
export function ensureCaptureDirSync(root: string, dir: string): string {
  const rootPath = resolve(root);
  const target = resolve(dir);
  const rel = relative(rootPath, target);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error(
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
      if (!isAlreadyThere(error)) throw error;
    }
    if (realpathSync(current) !== expected) {
      throw new Error(
        `Refusing to write into ${current}: it resolves outside the capture directory ${rootPath}`,
      );
    }
    if (!statSync(current).isDirectory()) {
      throw new Error(`Refusing to write into ${current}: it is not a directory`);
    }
  }
  return target;
}
