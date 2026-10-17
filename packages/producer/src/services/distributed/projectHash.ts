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

import { readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { PLAN_PROJECT_DIR_SKIP_SEGMENTS } from "./plan.js";

// Bump when the hashed set changes so uploads cached under an older scheme are never reused.
const SITE_ID_SCHEME = "site-v2\0";

/**
 * The files a site upload ships, as `/`-separated paths under `projectDir`. Symlinks are followed
 * (root included), top-level {@link PLAN_PROJECT_DIR_SKIP_SEGMENTS} are left out as the plan stage
 * does, and a dangling symlink throws.
 */
export function listSiteFiles(projectDir: string): string[] {
  const files: string[] = [];
  const ancestors = new Set([realpathSync(projectDir)]);
  function walk(dir: string, rel: string): void {
    for (const name of readdirSync(dir).sort()) {
      if (rel === "" && PLAN_PROJECT_DIR_SKIP_SEGMENTS.has(name)) continue;
      const full = join(dir, name);
      const relPath = rel === "" ? name : `${rel}/${name}`;
      let stat;
      try {
        stat = statSync(full);
      } catch (err) {
        throw new Error(`[listSiteFiles] cannot read ${relPath} (dangling symlink?)`, {
          cause: err,
        });
      }
      if (stat.isFile()) {
        files.push(relPath);
      } else if (stat.isDirectory()) {
        const real = realpathSync(full);
        // A folder linking back to an ancestor is skipped rather than walked forever.
        if (ancestors.has(real)) continue;
        ancestors.add(real);
        walk(full, relPath);
        ancestors.delete(real);
      }
    }
  }
  walk(projectDir, "");
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
 *
 * Reads are synchronous: project trees are typically tens of MB at most
 * (HTML/CSS/JS plus a few composition assets), so the simpler shape wins over
 * a streaming pipeline.
 */
export function hashProjectDir(
  projectDir: string,
  files: readonly string[] = listSiteFiles(projectDir),
): string {
  const hash = createHash("sha256").update(SITE_ID_SCHEME);
  for (const rel of files) {
    hash.update(rel);
    hash.update("\0");
    hash.update(readFileSync(join(projectDir, rel)));
  }
  return hash.digest("hex").slice(0, 16);
}
