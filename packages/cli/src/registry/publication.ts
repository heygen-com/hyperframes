import {
  lstatSync,
  chmodSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export function registryRoot(directory: string): string {
  mkdirSync(directory, { recursive: true });
  return realpathSync(directory);
}

export function registryTargetPath(root: string, target: string): string {
  const parts = target.split(/[\\/]/);
  if (isAbsolute(target) || parts.some(unsafeSegment)) throw new Error(`Unsafe target "${target}"`);
  let path = root;
  for (const part of parts) {
    path = join(path, part);
    if (lstatSync(path, { throwIfNoEntry: false })) path = realpathSync(path);
    assertContained(root, path);
  }
  return path;
}

function unsafeSegment(part: string): boolean {
  return (
    !part ||
    part === "." ||
    part === ".." ||
    /[<>:"|?*]/.test(part) ||
    Array.from(part).some((char) => char.charCodeAt(0) < 32) ||
    /[. ]$/.test(part) ||
    /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)
  );
}

function assertContained(root: string, path: string): void {
  const rel = relative(root, path);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error(`Unsafe target outside registry destination: ${path}`);
  }
}

/** Ancestor directories are trusted against concurrent local replacement during publication. */
export function publishRegistryFile(
  root: string,
  target: string,
  bytes: Uint8Array | string,
): string {
  const path = registryTargetPath(root, target);
  mkdirSync(dirname(path), { recursive: true });
  const parent = realpathSync(dirname(path));
  assertContained(root, parent);
  const destination = resolve(parent, basename(path));
  const stage = mkdtempSync(join(parent, ".hf-install-"));
  try {
    const stagedFile = join(stage, "file");
    writeFileSync(stagedFile, bytes, { flag: "wx" });
    const previous = lstatSync(destination, { throwIfNoEntry: false });
    if (previous?.isFile()) chmodSync(stagedFile, previous.mode & 0o777);
    renameSync(stagedFile, destination);
    return destination;
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}
