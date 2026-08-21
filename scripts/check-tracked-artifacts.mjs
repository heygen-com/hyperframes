import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const FORBIDDEN_BASENAMES = new Set([".DS_Store"]);

export function isForbiddenTrackedPath(filePath) {
  const normalized = filePath.replaceAll("\\", "/");
  const segments = normalized.split("/");
  return segments.includes("node_modules") || FORBIDDEN_BASENAMES.has(segments.at(-1));
}

export function findForbiddenTrackedPaths(filePaths) {
  return filePaths.filter(isForbiddenTrackedPath).sort();
}

export function readTrackedPaths(cwd = process.cwd()) {
  const result = spawnSync("git", ["ls-files", "-z"], {
    cwd,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `git ls-files exited with status ${result.status}`);
  }
  return result.stdout.split("\0").filter(Boolean);
}

export function checkTrackedArtifacts(cwd = process.cwd()) {
  return findForbiddenTrackedPaths(readTrackedPaths(cwd));
}

function main() {
  const forbidden = checkTrackedArtifacts();
  if (forbidden.length === 0) {
    console.log("Tracked artifact check passed.");
    return;
  }

  console.error("Forbidden generated artifacts are tracked by Git:");
  for (const filePath of forbidden) console.error(`- ${filePath}`);
  console.error("Remove these paths from the index; .gitignore already excludes them.");
  process.exitCode = 1;
}

const entryPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (entryPath === fileURLToPath(import.meta.url)) main();
