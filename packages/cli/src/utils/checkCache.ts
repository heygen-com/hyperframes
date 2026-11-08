import { createHash } from "node:crypto";
import {
  closeSync,
  fstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { CheckOptions, CheckReport } from "./checkTypes.js";

const SKIPPED_DIRS = new Set([".hyperframes", ".git"]);
// Bigger files (video, audio) are not read: size, mtime and ctime (which a tool cannot restore) stand for them.
const HASH_CONTENT_UP_TO = 2 * 1024 * 1024;
// Environment that changes what a check loads or how long it waits, so it is part of the key.
const VERDICT_ENV = /^(HYPERFRAMES?|PRODUCER|HF)_/;

class Uncacheable extends Error {}

function cachePath(projectDir: string): string {
  return join(projectDir, ".hyperframes", "cache", "check.json");
}

function fileFingerprint(path: string): string {
  const fd = openSync(path, "r");
  try {
    const stat = fstatSync(fd);
    if (stat.isDirectory()) throw new Uncacheable(`${path} is a linked directory`);
    return stat.size <= HASH_CONTENT_UP_TO
      ? createHash("sha256").update(readFileSync(fd)).digest("hex")
      : `${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}:${stat.ino}`;
  } finally {
    closeSync(fd);
  }
}

function hashTree(dir: string, prefix: string, hash: ReturnType<typeof createHash>): void {
  const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name < b.name ? -1 : 1,
  );
  for (const entry of entries) {
    if (SKIPPED_DIRS.has(entry.name)) continue;
    if (entry.name === "node_modules")
      throw new Uncacheable("node_modules can hold code the page runs");
    const path = join(dir, entry.name);
    const name = `${prefix}${entry.name}`;
    if (entry.isDirectory()) hashTree(path, `${name}/`, hash);
    else hash.update(`${name}\0${fileFingerprint(path)}\0`);
  }
}

/** Everything that can change a check verdict: the project files, the CLI build and the options. */
export function checkCacheKey(
  projectDir: string,
  options: CheckOptions,
  version: string,
): string | undefined {
  const hash = createHash("sha256").update(`${version}\0`);
  const { cache: _cache, ...verdictOptions } = options;
  const env = Object.entries(process.env)
    .filter(([name]) => VERDICT_ENV.test(name))
    .sort();
  hash.update(`${JSON.stringify([verdictOptions, env])}\0`);
  try {
    hashTree(projectDir, "", hash);
  } catch {
    return undefined; // an unreadable or linked tree is not cached; the check itself says what is wrong
  }
  return hash.digest("hex");
}

/** A budgeted run is partial, and these options need artifacts a replayed report cannot recreate. */
export function checkCacheable(options: CheckOptions): boolean {
  return (
    options.cache !== false &&
    !options.budget &&
    !options.snapshots &&
    !options.findingFrames &&
    !options.inspect
  );
}

export function readCachedPass(projectDir: string, key: string): CheckReport | undefined {
  try {
    const stored = JSON.parse(readFileSync(cachePath(projectDir), "utf8"));
    if (stored.key !== key || !stored.report?.ok) return undefined;
    return { ...stored.report, cached: { at: stored.at } };
  } catch {
    return undefined;
  }
}

/** Only a clean pass that ran the browser is stored; a failure is always re-run. */
export function storePass(projectDir: string, key: string, report: CheckReport): void {
  if (!report.ok || report.browserSkipped) return;
  try {
    mkdirSync(join(projectDir, ".hyperframes", "cache"), { recursive: true });
    const { saved: _saved, ...clean } = report as CheckReport & { saved?: unknown };
    writeFileSync(
      cachePath(projectDir),
      JSON.stringify({ key, at: new Date().toISOString(), report: clean }),
    );
  } catch {
    // A cache that cannot be written only costs the next run its speed-up.
  }
}
