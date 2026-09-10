/**
 * Publish a file under `src/generated` so a concurrent reader never observes it
 * half-written.
 *
 * The root build runs several package builds at once, and more than one of them
 * regenerates files here while a sibling's `tsc` is reading them. A plain
 * `writeFileSync` leaves the target truncated and then growing for the duration of
 * the write, which surfaces in whichever build read it mid-flight as
 * `TS1002: Unterminated string literal` — a failure that never reproduces locally,
 * because locally nothing is reading at that instant.
 *
 * Writing to a temp file in the same directory and renaming over the target makes
 * publication one atomic step: a reader sees either the whole previous file or the
 * whole new one, never a prefix. Same directory matters — `rename` is only atomic
 * within a filesystem.
 *
 * Byte-identical content is not republished, so a no-op rebuild leaves the mtime
 * alone and nothing downstream that keys off mtime is needlessly invalidated.
 *
 * Returns whether the target was replaced.
 *
 * Lives inside `packages/core` rather than the repo-root `scripts/` because every
 * container image that builds a package copies `packages/…` wholesale but
 * cherry-picks root scripts one file at a time. A helper the core build imports
 * has to travel with the package, or the image build fails on a missing module.
 */

import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export function writeGeneratedFile(outPath: string, contents: string): boolean {
  if (existsSync(outPath) && readFileSync(outPath, "utf8") === contents) return false;

  mkdirSync(dirname(outPath), { recursive: true });
  // Not a `.ts` suffix: the temp file sits inside the package's `src` glob, and a
  // concurrent `tsc` would otherwise try to compile it.
  const tempPath = `${outPath}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  try {
    writeFileSync(tempPath, contents, "utf8");
    renameSync(tempPath, outPath);
  } finally {
    rmSync(tempPath, { force: true });
  }
  return true;
}

/**
 * Runs the generated source through oxfmt's stdin so it is published already
 * formatted. Formatting the file after publishing it would rewrite it in place and
 * reopen the very window the atomic rename closes. Best effort: an environment
 * without oxfmt still gets a valid, if unformatted, artifact.
 */
export function formatGeneratedSource(source: string, outPath: string): string {
  try {
    return execFileSync("bun", ["x", "oxfmt", `--stdin-filepath=${outPath}`], {
      input: source,
      encoding: "utf8",
    });
  } catch {
    return source;
  }
}
