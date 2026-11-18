import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { isPathInside, terminalText } from "@hyperframes/core";
import { isPrivateFileUnder, isStudioPrivatePath } from "@hyperframes/core/safe-path";
import { isCopiedOutsideFileType } from "@hyperframes/studio-server/outside-file";
import {
  cssReferences,
  htmlReferences,
  isFile,
  isPageOrStylesheet,
  localPath,
  readHead,
  realOrNull,
  referencePath,
  type Reference,
} from "./fileReferences.js";
import { isPrivateCompositionFile, linksOutside } from "./privateProjectFile.js";

const MAX_FOLLOWED_FILES = 500;
const NAMES_SHOWN = 5;

export interface StagedFiles {
  leftOut: string[];
  complete: boolean;
}

interface NamedFile {
  raw: string;
  path: string;
  colorGradingLut: boolean;
}

/** A file the page may load: a composition, a type a local render copies in, or the grading table its LUT names. */
function stageable(root: string, file: NamedFile): boolean {
  const { path } = file;
  if (linksOutside(root, path)) return false;
  if (isPrivateFileUnder(root, path, isStudioPrivatePath) || isPrivateCompositionFile(root, path))
    return false;
  if (file.colorGradingLut && /\.cube$/i.test(path)) return true;
  return /\.html?$/i.test(path) || isCopiedOutsideFileType(path);
}

// A leading slash names the served root, as the local server reads it; compositions resolve as the compiler resolves them.
function namedPath(ref: Reference, file: string, root: string): string | null {
  if (!ref.composition && /^\/(?![/\\])/.test(ref.raw)) return localPath(ref.raw.slice(1), root);
  return referencePath(ref, file, root);
}

function namedFiles(file: string, root: string, result: StagedFiles): NamedFile[] {
  const read = readHead(file);
  if (read === null || !read.whole) result.complete = false;
  if (read === null) return [];
  const refs = /\.css$/i.test(file) ? cssReferences(read.text) : htmlReferences(read.text);
  return refs.flatMap((ref) => {
    const path = namedPath(ref, file, root);
    return path === null ? [] : [{ raw: ref.raw, path, colorGradingLut: !!ref.colorGradingLut }];
  });
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
): StagedFiles {
  const realRoot = realOrNull(root);
  if (realRoot === null) throw new Error(`Cannot read ${root}`);
  const result: StagedFiles = { leftOut: [], complete: true };
  const staged = new Set<string>();
  const pending: string[] = [];
  const stage = (path: string) => {
    const real = realOrNull(path);
    if (real === null || staged.has(real)) return;
    staged.add(real);
    const target = join(stagedDir, relative(realRoot, path));
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(real, target);
    if (!isPageOrStylesheet(path)) return;
    if (staged.size <= MAX_FOLLOWED_FILES) pending.push(path);
    else result.complete = false;
  };
  const leaveOut = (raw: string) => {
    if (!result.leftOut.includes(raw)) result.leftOut.push(raw);
  };
  realEntries(realRoot, entries).forEach(stage);
  for (let file = pending.pop(); file !== undefined; file = pending.pop()) {
    for (const named of namedFiles(file, realRoot, result)) {
      if (!isPathInside(named.path, realRoot)) leaveOut(named.raw);
      else if (!isFile(named.path)) continue;
      else if (stageable(realRoot, named)) stage(named.path);
      else leaveOut(named.raw);
    }
  }
  return result;
}

/** One line naming what a bare HTML file lost, or null when nothing was left out. */
export function leftOutNotice(command: string, result: StagedFiles): string | null {
  if (result.leftOut.length === 0 && result.complete) return null;
  const shown = result.leftOut.slice(0, NAMES_SHOWN).map((raw) => terminalText(raw));
  const more =
    result.leftOut.length > NAMES_SHOWN ? `, and ${result.leftOut.length - NAMES_SHOWN} more` : "";
  const named = shown.length > 0 ? ` left out ${shown.join(", ")}${more}.` : "";
  const partial = result.complete ? "" : " Some files were too large or too many to read in full.";
  return `${command}:${named}${partial} Only the files the page names in its own folder are served; pass the project folder to keep the rest.`;
}
