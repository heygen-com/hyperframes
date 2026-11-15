import { existsSync } from "node:fs";
import { isSafePath } from "@hyperframes/core/safe-path";
import { isWithinProjectRoot } from "@hyperframes/parsers/asset-resolution";

export function isInsideAssetRoots(path: string, roots: readonly string[]): boolean {
  if (roots.some((root) => isSafePath(root, path))) return true;
  // A name the file system refuses, such as a long data: URL, opens nothing, so its spelling decides.
  return !existsSync(path) && roots.some((root) => isWithinProjectRoot(root, path));
}
