/**
 * Content-addressing for a project directory, shared by the distributed-render
 * adapters' `deploySite` verbs.
 *
 * Each adapter uploads a project under `…/sites/<siteId>/` (AWS: a file list,
 * Cloud Run: a tarball) and skips content already uploaded. `siteId` is a
 * SHA-256 over the project's files so identical content always maps to the
 * same key — that contract has to be byte-identical across adapters, which is
 * exactly why it lives here rather than being copy-pasted per adapter.
 */

import { closeSync, openSync, readdirSync, readSync, realpathSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, sep } from "node:path";
import { isPrivateFileUnder, isStudioPrivatePath } from "@hyperframes/core/safe-path";
import { PLAN_PROJECT_DIR_SKIP_SEGMENTS } from "./plan.js";

// Bump when the hashed set changes so uploads cached under an older scheme are never reused.
const SITE_ID_SCHEME = "site-v2\0";
const READ_CHUNK_BYTES = 256 * 1024;

/** Whether a site's `/`-separated project path is one no upload ships: env, Git, credentials, tool state, app records. */
export const isPrivateSitePath = (relPath: string): boolean => isStudioPrivatePath(relPath);

function statEntry(full: string, relPath: string) {
  try {
    return statSync(full);
  } catch (err) {
    throw new Error(`[listSiteFiles] cannot read ${relPath} (dangling symlink?)`, { cause: err });
  }
}

/**
 * The files a site upload ships, as `/`-separated paths under `projectDir`. Symlinks are followed
 * (root included), out of the project only with `onOutside` `"include"`; top-level
 * {@link PLAN_PROJECT_DIR_SKIP_SEGMENTS} are left out as the plan stage does, and a dangling link
 * throws. Private files (env, Git, credentials, tool and agent state, app records) are left out at
 * every depth, by name or by link target. `onPrivate` and `onOutside` hear each, a folder once.
 */
export function listSiteFiles(
  projectDir: string,
  onPrivate?: (relPath: string) => void,
  onOutside: ((relPath: string) => void) | "include" = () => {},
): string[] {
  const files: string[] = [];
  const root = realpathSync(projectDir);
  const ancestors = new Set([root]);
  function visit(full: string, relPath: string): void {
    if (isPrivateFileUnder(projectDir, full, isStudioPrivatePath)) return void onPrivate?.(relPath);
    const stat = statEntry(full, relPath);
    if (!stat.isFile() && !stat.isDirectory()) return;
    if (onOutside !== "include" && outsideFolder(root, realpathSync(full))) {
      return void onOutside(relPath);
    }
    if (stat.isFile()) return void files.push(relPath);
    const real = realpathSync(full);
    // A folder linking back to an ancestor is skipped rather than walked forever.
    if (ancestors.has(real)) return;
    ancestors.add(real);
    walk(full, relPath);
    ancestors.delete(real);
  }
  function walk(dir: string, rel: string): void {
    for (const name of readdirSync(dir).sort()) {
      if (rel === "" && PLAN_PROJECT_DIR_SKIP_SEGMENTS.has(name)) continue;
      visit(join(dir, name), rel === "" ? name : `${rel}/${name}`);
    }
  }
  walk(projectDir, "");
  return files;
}

const outsideFolder = (root: string, real: string): boolean =>
  real !== root && !real.startsWith(root + sep);

const printablePath = (path: string): string =>
  [...path]
    .map((ch) => {
      const code = ch.charCodeAt(0);
      const control = (code < 0x20 && code !== 0x09) || (code >= 0x7f && code <= 0x9f);
      return control ? `\\x${code.toString(16).padStart(2, "0")}` : ch;
    })
    .join("");

/**
 * {@link listSiteFiles} for an upload: one line to `onNotice` names the private files left out.
 * Files linked in from outside ship only with `includeOutsideFiles`, else a second line names them.
 * The upload reads each path again after this check, so a link swapped in meanwhile still ships.
 */
export function listSiteFilesForUpload(
  projectDir: string,
  onNotice: (message: string) => void = (message) => console.warn(message),
  includeOutsideFiles = false,
): string[] {
  const leftOut: string[] = [];
  const outside: string[] = [];
  const files = listSiteFiles(
    projectDir,
    (path) => leftOut.push(path),
    includeOutsideFiles ? "include" : (path) => outside.push(path),
  );
  if (leftOut.length > 0) {
    const more = leftOut.length > 5 ? ` and ${leftOut.length - 5} more` : "";
    onNotice(
      `[deploySite] left out private files no composition loads (env, Git, credentials, tool state): ${leftOut.slice(0, 5).map(printablePath).join(", ")}${more}`,
    );
  }
  if (outside.length > 0) {
    onNotice(
      `[deploySite] left out files linked in from outside the project: ${outside.map(printablePath).join(", ")}. Pass --include-outside-files (includeOutsideFiles in the SDK) to upload them.`,
    );
  }
  return files;
}

/**
 * SHA-256 over a scheme tag plus each of {@link listSiteFiles}'s paths and
 * bytes → 16-character hex prefix. The prefix is the `siteId`.
 *
 * The hash includes the relative path plus every byte of each file, so a
 * same-bytes rename still yields a fresh id. We trim to 16 chars because the
 * full 64 isn't useful in an object key for legibility. Pass `files` when the
 * caller already listed them, so the hashed set is the shipped set.
 * Files are read in fixed-size chunks, so no file is ever held whole in memory.
 */
export function hashProjectDir(
  projectDir: string,
  files: readonly string[] = listSiteFiles(projectDir),
): string {
  const hash = createHash("sha256").update(SITE_ID_SCHEME);
  const chunk = Buffer.allocUnsafe(READ_CHUNK_BYTES);
  for (const rel of files) {
    hash.update(rel);
    hash.update("\0");
    const fd = openSync(join(projectDir, rel), "r");
    try {
      let read: number;
      while ((read = readSync(fd, chunk, 0, chunk.length, null)) > 0) {
        hash.update(chunk.subarray(0, read));
      }
    } finally {
      closeSync(fd);
    }
  }
  return hash.digest("hex").slice(0, 16);
}
