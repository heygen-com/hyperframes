import { existsSync } from "node:fs";
import {
  isPrivateFileUnder,
  isSafePath,
  isStudioPrivatePath,
  realFilePath,
  realPathWithin,
} from "@hyperframes/core/safe-path";
import {
  isWithinProjectRoot,
  namesAnotherNetworkRoot,
} from "@hyperframes/parsers/asset-resolution";

export function isInsideAssetRoots(path: string, roots: readonly string[]): boolean {
  if (roots.some((root) => isSafePath(root, path))) return true;
  // A name the file system refuses, such as a long data: URL, opens nothing, so its spelling decides.
  return roots.some((root) => isWithinProjectRoot(root, path)) && !existsSync(path);
}

const existingFileWithinUnlessOnAnotherNetworkRoot = (root: string, path: string): boolean =>
  !namesAnotherNetworkRoot(root, path) &&
  existsSync(path) &&
  realPathWithin(realFilePath(root), realFilePath(path));

// Judged from every root holding it, since a render's own work folder may sit in the project's `.hyperframes/`.
export function isPrivateUnderAssetRoots(
  path: string,
  roots: readonly string[],
  bySpellingOrRealFile = false,
): boolean {
  const holders = roots.filter(
    (root) =>
      isSafePath(root, path) ||
      (bySpellingOrRealFile && existingFileWithinUnlessOnAnotherNetworkRoot(root, path)),
  );
  return (
    holders.length > 0 &&
    holders.every((root) => isPrivateFileUnder(root, path, isStudioPrivatePath))
  );
}

export function assetRootsRefusal(path: string, roots: readonly string[]): string | null {
  if (!isInsideAssetRoots(path, roots)) return "outside the project folder";
  return isPrivateUnderAssetRoots(path, roots) ? "a private project file" : null;
}
