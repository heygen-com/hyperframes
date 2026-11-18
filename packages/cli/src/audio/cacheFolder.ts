import { lstatSync, mkdirSync } from "node:fs";
import { basename, dirname } from "node:path";

// The audio caches live in the project's .hyperframes/. A project can hold links someone else planted there, so
// a cache folder, and every file in it, is used only when it is real: a link in its place is never followed.

function foldersOf(path: string, depth: number): string[] {
  const folders: string[] = [];
  for (let folder = path; folders.length < depth; folder = dirname(folder)) folders.unshift(folder);
  return folders;
}

const isFolder = (path: string) =>
  lstatSync(path, { throwIfNoEntry: false })?.isDirectory() === true;

export function isRealFolder(path: string, depth: number): boolean {
  return foldersOf(path, depth).every(isFolder);
}

/** Makes the last `depth` folders of `path` where missing. Throws when a link or a file holds one's name. */
export function makeRealFolder(path: string, depth: number): string {
  for (const folder of foldersOf(path, depth)) {
    try {
      mkdirSync(folder);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    if (!isFolder(folder))
      throw new Error(
        `${basename(folder)} in ${dirname(folder)} is a link or a file, not a folder; remove it and run again`,
      );
  }
  return path;
}

export const isPlainFile = (path: string) =>
  lstatSync(path, { throwIfNoEntry: false })?.isFile() === true;

export const isPlainName = (name: unknown): name is string =>
  typeof name === "string" &&
  name !== "." &&
  name !== ".." &&
  !/[/\\]/.test(name) &&
  basename(name) === name;
