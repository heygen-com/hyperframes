import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The symbolic links the repo means to track. Any other link fails the check: tooling that publishes or reads
 * the tree (the docs image upload, registry and skills packaging) would follow it to whatever it names on the
 * machine running it.
 */
export const ALLOWED_SYMLINKS = new Set([
  "packages/cli/src/audio/scripts",
  "packages/producer/tests/render-symlinked-assets/src/shared",
]);

/** Paths of `git ls-files -s -z` entries with the symlink mode (120000). */
export function symlinkPaths(stagedListing) {
  return stagedListing
    .split("\0")
    .filter(Boolean)
    .filter((entry) => entry.startsWith("120000 "))
    .map((entry) => entry.slice(entry.indexOf("\t") + 1));
}

export function findUnexpectedSymlinks(paths, allowed = ALLOWED_SYMLINKS) {
  return paths.filter((path) => !allowed.has(path)).sort();
}

export function readStagedListing(cwd = process.cwd()) {
  const result = spawnSync("git", ["ls-files", "-s", "-z"], {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `git ls-files exited with status ${result.status}`);
  }
  return result.stdout;
}

export function checkSymlinks(cwd = process.cwd()) {
  return findUnexpectedSymlinks(symlinkPaths(readStagedListing(cwd)));
}

function main() {
  const unexpected = checkSymlinks();
  if (unexpected.length === 0) {
    console.log("Symlink check passed.");
    return;
  }
  console.error(
    "Symbolic links are tracked that are not on the allowlist in scripts/check-symlinks.mjs:",
  );
  for (const path of unexpected) console.error(`- ${path}`);
  console.error("Commit the file itself instead of a link to it.");
  process.exitCode = 1;
}

const entryPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (entryPath === fileURLToPath(import.meta.url)) main();
