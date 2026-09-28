import { existsSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { defineCommand } from "citty";
import {
  EXTRACT_CACHE_MIN_AGE_MS,
  directorySizeBytes,
  gcExtractionCache,
  resolveExtractCacheDir,
} from "@hyperframes/engine";
import {
  DEFAULT_HISTORY_ROOT,
  PROXY_CACHE_DIR_NAME,
  cleanupProxyCache,
  listProjectHistories,
  pruneGoneProjectHistories,
} from "@hyperframes/studio-server";
import type { Example } from "./_examples.js";
import { c } from "../ui/colors.js";
import { formatBytes } from "../ui/format.js";
import { setCommandExitCode } from "../utils/commandResult.js";
import { loadProducer } from "../utils/producer.js";
import { redactHome } from "./doctor.js";
import { withMeta } from "../utils/updateCheck.js";

export const examples: Example[] = [
  ["See what HyperFrames left on disk, remove nothing", "hyperframes clean --dry-run"],
  ["Remove it", "hyperframes clean"],
  ["Also remove snapshot folders", "hyperframes clean --snapshots"],
  ["For agents", "hyperframes clean --json"],
];

/** A render dir with no owner record (made before owners were recorded) counts as abandoned after this long idle. */
const OWNERLESS_IDLE_MS = 6 * 60 * 60 * 1000;
/** A video proxy nobody has used for this long is regenerable; a Studio still using one keeps touching it. */
const PROXY_IDLE_MS = 60 * 60 * 1000;

export interface Leftover {
  what: string;
  path: string;
  bytes: number;
}

export interface CleanOptions {
  projectDir: string;
  dryRun: boolean;
  snapshots: boolean;
  /** Where to look; each defaults to the real location (tests point them at scratch dirs). */
  historyRoot?: string;
  tempDir?: string;
  debugDir?: string;
}

export interface CleanResult {
  removed: Leftover[];
  alsoReclaimable: Leftover[];
  errors: string[];
}

interface Sweep {
  dryRun: boolean;
  result: CleanResult;
}

function recordError(sweep: Sweep, error: unknown): void {
  sweep.result.errors.push(error instanceof Error ? error.message : String(error));
}

/** Runs one kind of sweep; a failure is reported and the rest of the clean goes on. */
async function attempt(sweep: Sweep, step: () => unknown): Promise<void> {
  try {
    await step();
  } catch (error) {
    recordError(sweep, error);
  }
}

/** A HyperFrames project: its index.html holds a composition root, not just any website. */
function isProject(dir: string): boolean {
  try {
    return readFileSync(join(dir, "index.html"), "utf-8").includes("data-composition-id");
  } catch {
    return false;
  }
}

function realDir(dir: string): string {
  try {
    return realpathSync(dir);
  } catch {
    return resolve(dir);
  }
}

function knownProjectDirs(sweep: Sweep, historyRoot: string): string[] {
  try {
    return listProjectHistories(historyRoot).map((record) => record.projectDir);
  } catch (error) {
    recordError(sweep, error);
    return [];
  }
}

function drop(sweep: Sweep, what: string, path: string): void {
  const bytes = directorySizeBytes(path);
  try {
    if (!sweep.dryRun)
      rmSync(path, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    sweep.result.removed.push({ what, path, bytes });
  } catch (error) {
    recordError(sweep, error);
  }
}

function sweepProxies(sweep: Sweep, project: string): void {
  const proxies = join(project, PROXY_CACHE_DIR_NAME);
  const swept = cleanupProxyCache(proxies, {
    maxBytes: Number.POSITIVE_INFINITY,
    maxIdleMs: PROXY_IDLE_MS,
    minSweepIntervalMs: 0,
    dryRun: sweep.dryRun,
  });
  if (swept.removed.length === 0) return;
  sweep.result.removed.push({
    what: "Video proxies",
    path: proxies,
    bytes: swept.bytesBefore - swept.bytesAfter,
  });
}

function sweepSnapshots(sweep: Sweep, project: string, remove: boolean): void {
  const snapshots = join(project, "snapshots");
  if (!existsSync(snapshots)) return;
  if (remove) drop(sweep, "Snapshots", snapshots);
  else
    sweep.result.alsoReclaimable.push({
      what: "Snapshots",
      path: snapshots,
      bytes: directorySizeBytes(snapshots),
    });
}

async function sweepHistories(sweep: Sweep, historyRoot: string, tempDir: string): Promise<void> {
  const pruned = await pruneGoneProjectHistories(historyRoot, {
    dryRun: sweep.dryRun,
    onError: (error) => recordError(sweep, error),
    tempDir,
  });
  for (const history of pruned) {
    sweep.result.removed.push({
      what: "Project history",
      path: join(historyRoot, history.id),
      bytes: history.bytes,
    });
  }
}

function sweepExtractCache(sweep: Sweep): void {
  const extractCache = resolveExtractCacheDir().dir;
  if (!extractCache) return;
  const swept = gcExtractionCache(extractCache, {
    maxBytes: 0,
    minAgeMs: EXTRACT_CACHE_MIN_AGE_MS,
    dryRun: sweep.dryRun,
  });
  if (swept.evictedEntries + swept.agedPartialsRemoved === 0) return;
  sweep.result.removed.push({
    what: "Extracted video frames",
    path: extractCache,
    bytes: swept.evictedBytes,
  });
}

/** Everything HyperFrames left behind that no running render or preview uses; removed unless `dryRun`. */
export async function cleanLeftovers(options: CleanOptions): Promise<CleanResult> {
  const historyRoot = options.historyRoot ?? DEFAULT_HISTORY_ROOT;
  const tempDir = options.tempDir ?? tmpdir();
  const { RENDER_JOB_DIR, listAbandonedRenderDirs, resolveRenderDebugDir } = await loadProducer();
  const sweep: Sweep = {
    dryRun: options.dryRun,
    result: { removed: [], alsoReclaimable: [], errors: [] },
  };
  const dropAbandoned = (what: string, parent: string, names?: RegExp) => {
    for (const dir of listAbandonedRenderDirs(parent, {
      ownerlessIdleMs: OWNERLESS_IDLE_MS,
      names,
    }))
      drop(sweep, what, dir);
  };

  const projects = new Set(
    [options.projectDir, ...knownProjectDirs(sweep, historyRoot)].map(realDir),
  );
  const renderParents = new Set([
    ...[...projects].flatMap((project) => [project, join(project, "renders")]),
    realDir(tempDir),
  ]);
  for (const parent of renderParents) dropAbandoned("Render leftovers", parent);
  dropAbandoned("Debug renders", options.debugDir ?? resolveRenderDebugDir(), RENDER_JOB_DIR);
  for (const project of projects) {
    if (!isProject(project)) continue;
    await attempt(sweep, () => sweepProxies(sweep, project));
    sweepSnapshots(sweep, project, options.snapshots);
  }
  await attempt(sweep, () => sweepHistories(sweep, historyRoot, tempDir));
  await attempt(sweep, () => sweepExtractCache(sweep));
  return sweep.result;
}

function printTable(rows: Leftover[]): void {
  const whatWidth = Math.max(...rows.map((row) => row.what.length));
  for (const row of rows) {
    console.log(
      `  ${row.what.padEnd(whatWidth)}  ${formatBytes(row.bytes).padStart(9)}  ${c.dim(row.path)}`,
    );
  }
}

const total = (rows: Leftover[]) => rows.reduce((sum, row) => sum + row.bytes, 0);
const redactPaths = (rows: Leftover[]) =>
  rows.map((row) => ({ ...row, path: redactHome(row.path) }));

export default defineCommand({
  meta: { name: "clean", description: "Find and remove what HyperFrames left on disk" },
  args: {
    dir: {
      type: "positional",
      description: "Project directory (default: current); its subfolders are not searched",
      required: false,
    },
    "dry-run": {
      type: "boolean",
      description: "List what would be removed, remove nothing",
      default: false,
    },
    snapshots: { type: "boolean", description: "Also remove snapshots/ folders", default: false },
    json: { type: "boolean", description: "Output as JSON", default: false },
  },
  async run({ args }) {
    const dryRun = args["dry-run"];
    const result = await cleanLeftovers({
      projectDir: args.dir ?? process.cwd(),
      dryRun,
      snapshots: args.snapshots,
    });
    if (result.errors.length > 0) setCommandExitCode(1);
    if (args.json) {
      const report = withMeta({
        dryRun,
        removed: redactPaths(result.removed),
        alsoReclaimable: redactPaths(result.alsoReclaimable),
        errors: result.errors.map(redactHome),
        totalBytes: total(result.removed),
      });
      console.log(JSON.stringify(report, null, 2));
      return;
    }
    if (result.removed.length === 0) {
      console.log(`${c.success("◇")}  Nothing to clean`);
    } else {
      console.log(
        `${c.success("◇")}  ${dryRun ? "Would remove" : "Removed"} ${formatBytes(total(result.removed))}`,
      );
      printTable(result.removed);
    }
    if (result.alsoReclaimable.length > 0) {
      console.log(
        `\n   Also reclaimable with --snapshots: ${formatBytes(total(result.alsoReclaimable))}`,
      );
      printTable(result.alsoReclaimable);
    }
    for (const error of result.errors) console.log(c.warn(`  ${error}`));
  },
});
