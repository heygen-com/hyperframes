/**
 * Content-addressing for a project directory, shared by the distributed-render
 * adapters' `deploySite` verbs.
 *
 * Each adapter uploads a project tarball to `…/sites/<siteId>/project.tar.gz`
 * and short-circuits the upload when the object already exists. `siteId` is a
 * SHA-256 over the project's files so identical content always maps to the
 * same key — that contract has to be byte-identical across adapters, which is
 * exactly why it lives here rather than being copy-pasted per adapter.
 */

import { readdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, relative } from "node:path";
import { PLAN_PROJECT_DIR_SKIP_SEGMENTS } from "./plan.js";

/**
 * SHA-256 over every regular file under `projectDir` (sorted by relative
 * path) → 16-character hex prefix. The prefix is the `siteId`.
 *
 * The hash includes the relative path plus every byte of each file, so a
 * same-bytes rename still yields a fresh id. We trim to 16 chars because the
 * full 64 isn't useful in an object key for legibility. Top-level segments in
 * {@link PLAN_PROJECT_DIR_SKIP_SEGMENTS} (e.g. `node_modules`) are skipped to
 * match what the plan stage copies.
 *
 * Reads are synchronous: project trees are typically tens of MB at most
 * (HTML/CSS/JS plus a few composition assets), so the simpler shape wins over
 * a streaming pipeline.
 */
export function hashProjectDir(projectDir: string): string {
  const hash = createHash("sha256");
  const files: string[] = [];
  function walk(dir: string, isRoot: boolean): void {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    )) {
      if (isRoot && PLAN_PROJECT_DIR_SKIP_SEGMENTS.has(entry.name)) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full, false);
      else if (entry.isFile()) files.push(full);
    }
  }
  walk(projectDir, true);
  for (const file of files) {
    const rel = relative(projectDir, file).replaceAll("\\", "/");
    hash.update(rel);
    hash.update("\0");
    hash.update(readFileSync(file));
  }
  return hash.digest("hex").slice(0, 16);
}
