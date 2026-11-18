import { existsSync, lstatSync, readlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, relative, resolve, isAbsolute, sep } from "node:path";
import { errnoMissingPathOf } from "@hyperframes/core/missing-path";

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
  workDir?: string;
}

const inside = (path: string, folder: string) => {
  const rel = relative(resolve(folder), resolve(path));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
};

function lstatOrNull(path: string) {
  try {
    return lstatSync(path);
  } catch {
    // expected: what is gone has nothing to stat
    return null;
  }
}

const ROOT_SCOPES = [
  ["tempRoot", "temp_root"],
  ["cacheDir", "cache_root"],
  ["workDir", "work_dir"],
] as const;

const NAME_SCOPES: ReadonlyArray<[RegExp, MissingPathFacts["scope"]]> = [
  [/\.partial/, "cache_partial"],
  [/^hfcache-/, "cache_entry"],
  [/^hyperframes-extract-cache/, "cache_root"],
  [/^(hf-render-|work-[0-9a-f]{8}-)/, "work_dir"],
];

function scopeOfGone(path: string, where: Where, throughLink: boolean): MissingPathFacts["scope"] {
  const root = ROOT_SCOPES.find(([key]) => {
    const dir = where[key];
    return !!dir && resolve(path) === resolve(dir);
  });
  if (root) return root[1];
  const name = basename(path);
  return (
    NAME_SCOPES.find(([pattern]) => pattern.test(name))?.[1] ??
    (throughLink ? "link_target" : "other")
  );
}

const MAX_LINK_HOPS = 4;

function rootOf(path: string, where: Where): MissingPathFacts["root"] {
  if (inside(path, where.tempRoot)) return "system_temp";
  if (where.cacheDir && inside(path, where.cacheDir)) return "cache_dir";
  return "other";
}

const ownerOf = (path: string, where: Where) =>
  [where.tempRoot, where.cacheDir, where.workDir]
    .filter((root): root is string => !!root && inside(path, root))
    .sort((a, b) => resolve(a).length - resolve(b).length)[0];

const linkTarget = (link: string, folder: string) =>
  resolve(folder, readlinkSync(link).replace(/^\\\\\?\\/, ""));

function goneAt(
  path: string,
  last: boolean,
  where: Where,
  hops: number,
): MissingPathFacts["scope"] {
  const scope = scopeOfGone(path, where, hops > 0);
  return last && scope === "other" ? "file" : scope;
}

/** Walks down from the render's own folder with lstat, checking each link's target before going through it. */
function highestGone(path: string, where: Where, hops = 0): MissingPathFacts["scope"] | undefined {
  const root = ownerOf(path, where);
  if (!root || hops > MAX_LINK_HOPS) return "link_target";
  if (!existsSync(root)) return scopeOfGone(root, where, hops > 0);
  const parts = relative(resolve(root), resolve(path)).split(sep).filter(Boolean);
  let at = resolve(root);
  for (const [index, part] of parts.entries()) {
    const next = join(at, part);
    const stat = lstatOrNull(next);
    if (!stat) return goneAt(next, index === parts.length - 1, where, hops);
    at = stat.isSymbolicLink() ? linkTarget(next, at) : next;
    const gone = at === next ? undefined : highestGone(at, where, hops + 1);
    if (gone) return gone;
  }
  return undefined;
}

const isSpawnFailure = (error: unknown) =>
  !!(error as NodeJS.ErrnoException | undefined)?.syscall?.startsWith("spawn");

/** What was gone around the path a failed render's ENOENT names; undefined when it names none or the look fails.
 * Only the render's own folders are looked at, never a share; call it before the render's own cleanup runs. */
export function describeMissingPath(
  error: unknown,
  {
    cacheDir,
    workDir,
    tempRoot = tmpdir(),
  }: { cacheDir?: string; workDir?: string; tempRoot?: string } = {},
): MissingPathFacts | undefined {
  try {
    const path = errnoMissingPathOf(error);
    if (!path || isSpawnFailure(error)) return undefined;
    const where = { tempRoot, cacheDir, workDir };
    return {
      scope: ownerOf(path, where)
        ? (highestGone(path, where) ?? "other")
        : scopeOfGone(path, where, false),
      synced: SYNCED.test(path),
      root: rootOf(path, where),
    };
  } catch {
    // expected: the folders can change under the look; the render's own error must still be what is reported
    return undefined;
  }
}
