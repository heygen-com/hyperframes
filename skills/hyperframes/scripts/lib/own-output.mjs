// A project can arrive (by git clone or tar) with a link at a helper's output name. Writing through it would
// overwrite whatever file the link names, so outputs are built under a fresh name and renamed over the old one.
import { randomUUID } from "node:crypto";
import { lstatSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";

const isLink = (path) => lstatSync(path, { throwIfNoEntry: false })?.isSymbolicLink() ?? false;

/**
 * `dir` as a real folder, made if missing. A link at `dir` is removed and a folder made in its place; a folder above
 * it inside the working folder that is a link is refused, since it may be the person's own.
 */
export function ownFolder(dir) {
  const target = resolve(dir);
  const root = process.cwd();
  if (target.startsWith(root + sep)) {
    for (let at = dirname(target); at !== root; at = dirname(at)) {
      if (isLink(at)) throw new Error(`refusing to write into ${at}: it is a link`);
    }
  }
  if (isLink(target)) rmSync(target);
  mkdirSync(target, { recursive: true });
  return target;
}

/** Runs `build(temp)` to make the output at a fresh name beside `dest`, then renames it over `dest`. */
export function replaceOutput(dest, build) {
  const temp = join(ownFolder(dirname(dest)), `.${randomUUID()}-${basename(dest)}`);
  try {
    build(temp);
    renameSync(temp, dest);
  } finally {
    rmSync(temp, { force: true });
  }
}

/** Writes `data` to `dest` as a new regular file. */
export const replaceFile = (dest, data) =>
  replaceOutput(dest, (temp) => writeFileSync(temp, data, { flag: "wx" }));
