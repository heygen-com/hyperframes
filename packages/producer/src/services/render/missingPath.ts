import { existsSync, lstatSync, readlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, relative, resolve, isAbsolute } from "node:path";
import { missingPathOf } from "@hyperframes/core/missing-path";

/** What was gone around a missing path when the render failed, from closed lists only: never a path or a name. */
export interface MissingPathFacts {
  /** The highest thing gone on the path; a link on the way is read through to its target. */
  scope:
    | "file"
    | "link_target"
    | "cache_entry"
    | "cache_partial"
    | "cache_root"
    | "work_dir"
    | "temp_root"
    | "other";
  /** Under a folder a sync app owns (OneDrive, Dropbox, iCloud, Google Drive). */
  synced: boolean;
  root: "system_temp" | "cache_dir" | "other";
}

const SYNCED = /onedrive|dropbox|icloud|mobile documents|clouddocs|google ?drive|cloudstorage/i;

interface Where {
  tempRoot: string;
  cacheDir?: string;
}

const inside = (path: string, folder: string) => {
  const rel = relative(resolve(folder), resolve(path));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
};

function isLink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    // expected: a missing path is no link
    return false;
  }
}

function scopeOfGone(path: string, where: Where, throughLink: boolean): MissingPathFacts["scope"] {
  if (resolve(path) === resolve(where.tempRoot)) return "temp_root";
  if (where.cacheDir && resolve(path) === resolve(where.cacheDir)) return "cache_root";
  const name = basename(path);
  if (/\.partial/.test(name)) return "cache_partial";
  if (/^hfcache-/.test(name)) return "cache_entry";
  if (/^hyperframes-extract-cache/.test(name)) return "cache_root";
  if (/^(hf-render-|work-[0-9a-f]{8}-)/.test(name)) return "work_dir";
  return throughLink ? "link_target" : "other";
}

const MAX_LINK_HOPS = 4;

function rootOf(path: string, where: Where): MissingPathFacts["root"] {
  if (inside(path, where.tempRoot)) return "system_temp";
  if (where.cacheDir && inside(path, where.cacheDir)) return "cache_dir";
  return "other";
}

/** A dangling link on the way, read through to its target only when that target is in the temp root or the cache folder. */
function goneThroughLink(link: string, where: Where, hops: number): MissingPathFacts["scope"] {
  const target = resolve(dirname(link), readlinkSync(link).replace(/^\\\\\?\\/, ""));
  return rootOf(target, where) !== "other" && hops < MAX_LINK_HOPS
    ? highestGone(target, where, hops + 1)
    : "link_target";
}

/** The highest thing gone on `path`: the first folder up whose parent is there. */
function highestGone(path: string, where: Where, hops = 0): MissingPathFacts["scope"] {
  for (let at = path; dirname(at) !== at; at = dirname(at)) {
    const parent = dirname(at);
    if (isLink(parent) && !existsSync(parent)) return goneThroughLink(parent, where, hops);
    if (!existsSync(parent)) continue;
    const scope = scopeOfGone(at, where, hops > 0);
    return at === path && scope === "other" ? "file" : scope;
  }
  return "other";
}

const isSpawnFailure = (error: unknown) =>
  !!(error as NodeJS.ErrnoException | undefined)?.syscall?.startsWith("spawn");

/** What was gone around the path a failed render's ENOENT names; undefined when it names none or the look fails.
 * Call it before the render's own cleanup runs. */
export function describeMissingPath(
  error: unknown,
  { cacheDir, tempRoot = tmpdir() }: { cacheDir?: string; tempRoot?: string } = {},
): MissingPathFacts | undefined {
  try {
    const path = missingPathOf(error);
    if (!path || isSpawnFailure(error)) return undefined;
    const where = { tempRoot, cacheDir };
    return {
      scope: highestGone(path, where),
      synced: SYNCED.test(path),
      root: rootOf(path, where),
    };
  } catch {
    // expected: the folders can change under the look; the render's own error must still be what is reported
    return undefined;
  }
}
