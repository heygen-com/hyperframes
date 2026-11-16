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
import { join } from "node:path";
import { isPrivateFileUnder, isStudioPrivatePath } from "@hyperframes/core/safe-path";
import { PLAN_PROJECT_DIR_SKIP_SEGMENTS } from "./plan.js";

// Bump when the hashed set changes so uploads cached under an older scheme are never reused.
const SITE_ID_SCHEME = "site-v2\0";
const READ_CHUNK_BYTES = 256 * 1024;

function statEntry(full: string, relPath: string) {
  try {
    return statSync(full);
  } catch (err) {
    throw new Error(`[listSiteFiles] cannot read ${relPath} (dangling symlink?)`, { cause: err });
  }
}

/**
 * The files a site upload ships, as `/`-separated paths under `projectDir`. Symlinks are followed
 * (root included), top-level {@link PLAN_PROJECT_DIR_SKIP_SEGMENTS} are left out as the plan stage
 * does, and a dangling symlink throws. Private files (env, Git, credentials, tool and agent state,
 * app records) are left out at every depth, by name or by where a link points; `onPrivate` hears
 * each one left out, a folder once.
 */
export function listSiteFiles(projectDir: string, onPrivate?: (relPath: string) => void): string[] {
  const files: string[] = [];
  const ancestors = new Set([realpathSync(projectDir)]);
  function visit(full: string, relPath: string): void {
    if (isPrivateFileUnder(projectDir, full, isStudioPrivatePath)) return void onPrivate?.(relPath);
    const stat = statEntry(full, relPath);
    if (stat.isFile()) return void files.push(relPath);
    if (!stat.isDirectory()) return;
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

/** {@link listSiteFiles} for an upload: one line to `onNotice` names the private files left out. */
export function listSiteFilesForUpload(
  projectDir: string,
  onNotice?: (message: string) => void,
): string[] {
  const leftOut: string[] = [];
  const files = listSiteFiles(projectDir, (path) => leftOut.push(path));
  if (leftOut.length > 0) {
    const more = leftOut.length > 5 ? ` and ${leftOut.length - 5} more` : "";
    onNotice?.(
      `[deploySite] left out private files no composition loads (env, Git, credentials, tool state): ${leftOut.slice(0, 5).join(", ")}${more}`,
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
