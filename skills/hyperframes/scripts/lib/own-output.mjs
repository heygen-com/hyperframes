// A project can arrive (by git clone or tar) with a link at a helper's output name. Writing through it would
// overwrite whatever file the link names, so outputs are built under a fresh name and renamed over the old one.
import { randomUUID } from "node:crypto";
import { lstatSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";

const isLink = (path) => lstatSync(path, { throwIfNoEntry: false })?.isSymbolicLink() ?? false;

/**
 * `dir` as a real folder, made if missing. Inside the working folder a link at `dir` is replaced by a real folder,
 * and one above it is refused. Outside it a link at `dir` is refused: it is the person's own, and theirs to keep.
 */
export function ownFolder(dir) {
  const target = resolve(dir);
  const root = process.cwd();
  const inside = target.startsWith(root + sep);
  if (inside) {
    for (let at = dirname(target); at !== root; at = dirname(at)) {
      if (isLink(at)) throw new Error(`refusing to write into ${at}: it is a link`);
    }
  }
  if (isLink(target)) {
    if (!inside) throw new Error(`refusing to write into ${target}: it is a link`);
    rmSync(target);
  }
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
