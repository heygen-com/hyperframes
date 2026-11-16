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

function scopeOfGone(
  path: string,
  tempRoot: string,
  throughLink: boolean,
): MissingPathFacts["scope"] {
  if (resolve(path) === resolve(tempRoot)) return "temp_root";
  const name = basename(path);
  if (/\.partial/.test(name)) return "cache_partial";
  if (/^hfcache-/.test(name)) return "cache_entry";
  if (/^hyperframes-extract-cache/.test(name)) return "cache_root";
  if (/^(hf-render-|work-[0-9a-f]{8}-)/.test(name)) return "work_dir";
  return throughLink ? "link_target" : "other";
}

/** The highest thing gone on `path`: the first folder up whose parent is there; a dangling link on the way is read
 * through to where it pointed. */
function highestGone(
  path: string,
  tempRoot: string,
  throughLink = false,
): MissingPathFacts["scope"] {
  for (let at = path; dirname(at) !== at; at = dirname(at)) {
    const parent = dirname(at);
    if (isLink(parent) && !existsSync(parent)) {
      const target = readlinkSync(parent).replace(/^\\\\\?\\/, "");
      return highestGone(resolve(dirname(parent), target), tempRoot, true);
    }
    if (!existsSync(parent)) continue;
    return at === path && !throughLink ? "file" : scopeOfGone(at, tempRoot, throughLink);
  }
  return "other";
}

function rootOf(
  path: string,
  tempRoot: string,
  cacheDir: string | undefined,
): MissingPathFacts["root"] {
  if (inside(path, tempRoot)) return "system_temp";
  if (cacheDir && inside(path, cacheDir)) return "cache_dir";
  return "other";
}

/** What was gone around the path a failed render's ENOENT names; undefined when it names none.
 * Call it before the render's own cleanup runs. */
export function describeMissingPath(
  error: unknown,
  { cacheDir, tempRoot = tmpdir() }: { cacheDir?: string; tempRoot?: string } = {},
): MissingPathFacts | undefined {
  const path = missingPathOf(error);
  if (!path) return undefined;
  return {
    scope: highestGone(path, tempRoot),
    synced: SYNCED.test(path),
    root: rootOf(path, tempRoot, cacheDir),
  };
}
