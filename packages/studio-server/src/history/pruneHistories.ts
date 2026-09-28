import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { lstat, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isSafePath } from "../helpers/safePath.js";
import { ID_PATH, isHistoryId, readId, readRecord } from "./historyId.js";
import { HistoryBusyError, takeHistoryOwnership } from "./ownerLock.js";

const DAY_MS = 24 * 60 * 60 * 1000;
/** A gone project's history stays this long after its last use, so a moved project reopened in time keeps it. */
export const KEEP_GONE_PROJECT_HISTORY_MS = 14 * DAY_MS;
const PRUNED_PREFIX = ".pruned-";
const LAST_PRUNE_FILE = ".last-prune";

interface PruneOptions {
  now?: number;
  /** Reports what would go, with the same checks, and removes nothing. */
  dryRun?: boolean;
  /** Projects under this folder are scratch: their history goes as soon as they do. */
  tempDir?: string;
  /** One history that could not be checked or removed; the rest are still pruned. */
  onError?: (error: unknown) => void;
  /** Starts no further history after this long; the rest wait for the next run. */
  budgetMs?: number;
}

export interface PrunedHistory {
  id: string;
  projectDir: string;
  bytes: number;
}

/** Removes the histories whose project is gone and that no live process holds. */
export async function pruneGoneProjectHistories(
  historyRoot: string,
  options: PruneOptions = {},
): Promise<PrunedHistory[]> {
  return (await pruneWithin(historyRoot, options)).pruned;
}

async function pruneWithin(
  historyRoot: string,
  {
    now = Date.now(),
    dryRun = false,
    tempDir = tmpdir(),
    onError = (error) => console.warn("[history] could not prune a history:", error),
    budgetMs = Infinity,
    measure = true,
  }: PruneOptions & { measure?: boolean },
): Promise<{ pruned: PrunedHistory[]; finished: boolean }> {
  const started = performance.now();
  let names: string[];
  try {
    names = readdirSync(historyRoot);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { pruned: [], finished: true };
    throw error;
  }
  const pruned: PrunedHistory[] = [];
  for (const name of names) {
    if (performance.now() - started >= budgetMs) return { pruned, finished: false };
    try {
      const gone = await pruneEntry(historyRoot, name, { now, dryRun, tempDir, measure });
      if (gone) pruned.push(gone);
    } catch (error) {
      onError(error);
    }
  }
  return { pruned, finished: true };
}

async function pruneEntry(historyRoot: string, name: string, run: PruneRun) {
  if (name.startsWith(PRUNED_PREFIX)) {
    if (!run.dryRun) await rm(join(historyRoot, name), { recursive: true, force: true });
    return null;
  }
  return isHistoryId(name) ? pruneOne(historyRoot, name, run) : null;
}

type PruneRun = { now: number; dryRun: boolean; tempDir: string; measure: boolean };

async function pruneOne(
  historyRoot: string,
  id: string,
  run: PruneRun,
): Promise<PrunedHistory | null> {
  const home = join(historyRoot, id);
  if (abandonedProject(home, id, run.now, run.tempDir) === null) return null;
  const release = await takeUnlessBusy(home);
  if (!release) return null;
  let taken: { projectDir: string; trash: string | null } | null;
  try {
    taken = recheckAndMoveAway(historyRoot, id, run);
  } catch (error) {
    release();
    throw error;
  }
  if (!taken?.trash) release();
  if (!taken) return null;
  const bytes = await clearAway(taken.trash, home, run.measure);
  return { id, projectDir: taken.projectDir, bytes };
}

/** Removes the moved-away history, if any; its size when asked, measured first. */
async function clearAway(trash: string | null, home: string, measure: boolean): Promise<number> {
  const bytes = measure ? await bytesIn(trash ?? home) : 0;
  if (trash) await rm(trash, { recursive: true, force: true });
  return bytes;
}

async function takeUnlessBusy(home: string): Promise<(() => void) | null> {
  try {
    return await takeHistoryOwnership(home, 0);
  } catch (error) {
    if (error instanceof HistoryBusyError) return null;
    throw error;
  }
}

function recheckAndMoveAway(historyRoot: string, id: string, { now, dryRun, tempDir }: PruneRun) {
  const home = join(historyRoot, id);
  // Re-read under the lock: an open that recorded this project again meanwhile keeps it.
  const projectDir = abandonedProject(home, id, now, tempDir);
  if (projectDir === null) return null;
  if (dryRun) return { projectDir, trash: null };
  // One rename takes the lock along, so an interrupted delete leaves a `.pruned-` folder the next run finishes.
  const trash = join(historyRoot, `${PRUNED_PREFIX}${id}-${randomUUID()}`);
  renameSync(home, trash);
  return { projectDir, trash };
}

/** The folder a history was recorded for, when that project is gone; null while it may still need its history. */
function abandonedProject(home: string, id: string, now: number, tempDir: string): string | null {
  const dir = readRecord(home)?.dir;
  if (typeof dir !== "string") return null;
  if (now - lastUsed(home) < KEEP_GONE_PROJECT_HISTORY_MS && !isSafePath(tempDir, dir)) return null;
  if (!statSync(join(dir, ID_PATH), { throwIfNoEntry: false })) return dir;
  // An id file this version cannot read is refused, never replaced, so its history is still the project's.
  const there = readId(dir);
  return there !== null && there !== id ? dir : null;
}

function lastUsed(home: string): number {
  const mtime = (file: string) =>
    statSync(join(home, file), { throwIfNoEntry: false })?.mtimeMs ?? 0;
  return Math.max(mtime("project.json"), mtime("log.jsonl"));
}

async function bytesIn(dir: string): Promise<number> {
  let total = 0;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    total += entry.isDirectory() ? await bytesIn(path) : (await lstat(path)).size;
  }
  return total;
}

function prunedWithinADay(stamp: string, now: number): boolean {
  try {
    const last = Number(readFileSync(stamp, "utf-8"));
    return last <= now && now - last < DAY_MS;
  } catch {
    return false;
  }
}

const pruning = new Set<string>();

/** Prunes `historyRoot` in the background until one run finishes a day, whichever process opens a history first. */
export function pruneGoneProjectHistoriesDaily(
  historyRoot: string,
  now: number,
  { onError, budgetMs }: Pick<PruneOptions, "onError" | "budgetMs"> = {},
): void {
  const stamp = join(historyRoot, LAST_PRUNE_FILE);
  if (pruning.has(historyRoot) || prunedWithinADay(stamp, now)) return;
  pruning.add(historyRoot);
  setImmediate(() => {
    pruneWithin(historyRoot, { now, onError, budgetMs, measure: false })
      .then(({ finished }) => finished && writeFileSync(stamp, String(now)))
      .catch((error) => onError?.(error))
      .finally(() => pruning.delete(historyRoot));
  });
}
