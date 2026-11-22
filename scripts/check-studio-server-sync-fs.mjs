// Studio's routes and history engine run on the host's event loop (the CLI's preview server, the desktop app's main
// process): a synchronous read of a folder whose drive stopped answering holds that loop for as long as the drive is
// silent. Each file may only lose such calls, never gain one; its count is kept in the baseline beside this script.
import * as fs from "node:fs";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(import.meta.dirname, "..");
const AREAS = ["packages/studio-server/src/routes", "packages/studio-server/src/history"];
const BASELINE = join(import.meta.dirname, "studio-server-sync-fs-baseline.json");
// Every synchronous call the running node:fs has (`globSync` and any later one), `realpathSync.native` included.
const SYNC_NAMES = Object.keys(fs).filter((name) => name.endsWith("Sync"));
const SYNC_CALL = new RegExp(`\\b(?:${SYNC_NAMES.join("|")})(?:\\.native)?\\s*\\(`, "g");

/** How many synchronous fs calls `source` makes, comment lines aside. @param {string} source */
export function countSyncCalls(source) {
  return source
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .reduce((sum, line) => sum + (line.match(SYNC_CALL)?.length ?? 0), 0);
}

/** @param {string} dir @returns {string[]} */
function sourceFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "__fixtures__" ? [] : sourceFiles(path);
    return /\.ts$/.test(name) && !/\.test\.ts$/.test(name) ? [path] : [];
  });
}

/** Each area file's count, by its path from the repo root. */
export function currentCounts(root = ROOT) {
  return Object.fromEntries(
    AREAS.flatMap((area) => sourceFiles(join(root, area)))
      .map((path) => [
        relative(root, path).split(sep).join("/"),
        countSyncCalls(readFileSync(path, "utf8")),
      ])
      .filter(([, count]) => count > 0)
      .sort(([a], [b]) => a.localeCompare(b)),
  );
}

/** The files that gained a synchronous fs call over the baseline. */
export function gained(current, baseline) {
  return Object.entries(current)
    .filter(([path, count]) => count > (baseline[path] ?? 0))
    .map(
      ([path, count]) => `${path}: ${count} synchronous fs calls, ${baseline[path] ?? 0} allowed`,
    );
}

function main() {
  const current = currentCounts();
  if (process.argv.includes("--write")) {
    writeFileSync(BASELINE, `${JSON.stringify(current, null, 2)}\n`);
    return;
  }
  const problems = gained(current, JSON.parse(readFileSync(BASELINE, "utf8")));
  if (problems.length === 0) return;
  console.error(
    "Studio's routes and history engine read the disk with fs/promises, never a *Sync call:\n" +
      problems.map((line) => `  ${line}`).join("\n"),
  );
  process.exit(1);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
