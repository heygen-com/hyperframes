import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { isPathInside } from "@hyperframes/core";
import { isPrivateFileUnder, isStudioPrivatePath } from "@hyperframes/core/safe-path";
import { isCopiedOutsideFileType } from "@hyperframes/studio-server/outside-file";
import {
  cssReferences,
  htmlReferences,
  isFile,
  isPageOrStylesheet,
  readHead,
  realOrNull,
  referencePath,
} from "./fileReferences.js";
import { isPrivateCompositionFile, linksOutside } from "./privateProjectFile.js";

const MAX_FOLLOWED_FILES = 500;

/** A file the page may load: a composition, or a type a local render copies in (image, video, audio, font, CSS, JS). */
function stageable(root: string, path: string): boolean {
  if (linksOutside(root, path)) return false;
  if (isPrivateFileUnder(root, path, isStudioPrivatePath) || isPrivateCompositionFile(root, path))
    return false;
  return /\.html?$/i.test(path) || isCopiedOutsideFileType(path);
}

// Compositions resolve from the root, as the compiler resolves them; other names from the file that holds them.
function referencesOf(file: string, root: string): string[] {
  const read = readHead(file);
  if (read === null) return [];
  const refs = /\.css$/i.test(file) ? cssReferences(read.text) : htmlReferences(read.text);
  return refs.flatMap((ref) => {
    const path = referencePath(ref, file, root);
    return path === null ? [] : [path];
  });
}

function stageableReferences(file: string, root: string): string[] {
  return referencesOf(file, root).filter(
    (path) => isPathInside(path, root) && isFile(path) && stageable(root, path),
  );
}

function realEntries(root: string, entries: readonly string[]): string[] {
  return entries.map((entry) => {
    const real = realOrNull(entry);
    if (real === null || !isPathInside(real, root)) throw new Error(`Cannot read ${entry}`);
    return real;
  });
}

/**
 * Copies `entries` into `stagedDir` with the files their markup, sub-compositions and stylesheets name under `root`.
 * A page someone sent runs on the origin that serves `stagedDir`, so nothing else under `root` is put there: not
 * private files, not other file types, not names the page builds in script.
 */
export function stageReferencedFiles(
  root: string,
  entries: readonly string[],
  stagedDir: string,
): void {
  const realRoot = realOrNull(root);
  if (realRoot === null) throw new Error(`Cannot read ${root}`);
  const staged = new Set<string>();
  const pending: string[] = [];
  const stage = (path: string) => {
    const real = realOrNull(path);
    if (real === null || staged.has(real)) return;
    staged.add(real);
    const target = join(stagedDir, relative(realRoot, path));
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(real, target);
    if (isPageOrStylesheet(path) && staged.size <= MAX_FOLLOWED_FILES) pending.push(path);
  };
  realEntries(realRoot, entries).forEach(stage);
  for (let file = pending.pop(); file !== undefined; file = pending.pop()) {
    stageableReferences(file, realRoot).forEach(stage);
  }
}
