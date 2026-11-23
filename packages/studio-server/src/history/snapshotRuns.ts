import {
  type Stats,
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  ftruncateSync,
  writeSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import type { ArtifactRecord, VideoState } from "./videoState.js";

const SNAPSHOT_RUNS_TO_KEEP = 10;
export const SNAPSHOT_GRACE_MS = 24 * 60 * 60 * 1000;
const OWNER = ".capture-owner.json";
const ownedMarkers = new Map<string, Stats>();
const UUID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
const rootOf = (project: string) =>
  join(resolve(project), ".hyperframes", "artifacts", "snapshots");

function ordinaryPath(project: string, path: string): boolean {
  const root = resolve(project);
  const rel = relative(root, path);
  if (rel === ".." || rel.startsWith(`..${sep}`)) return false;
  let current = root;
  for (const part of rel.split(sep).filter(Boolean)) {
    current = join(current, part);
    try {
      if (lstatSync(current).isSymbolicLink()) return false;
    } catch {
      return false;
    }
  }
  return true;
}

function createSnapshotParents(project: string, path: string): void {
  let parent = resolve(project);
  for (const part of relative(parent, path).split(sep).filter(Boolean)) {
    parent = join(parent, part);
    try {
      mkdirSync(parent);
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
    }
    if (!ordinaryPath(project, parent)) throw new Error("Snapshot storage must not use symlinks.");
  }
}

/** A live CLI owns its captures until exit, including late contact-sheet and description writes. */
export function ownSnapshotRun(project: string, path: string): void {
  const root = rootOf(project);
  if (dirname(path) !== root || !UUID.test(path.slice(root.length + 1))) return;
  createSnapshotParents(project, root);
  mkdirSync(path);
  const marker = join(path, OWNER);
  const fd = openSync(marker, "wx");
  try {
    writeFileSync(fd, JSON.stringify({ version: 1, pid: process.pid }));
    ownedMarkers.set(marker, fstatSync(fd));
  } finally {
    closeSync(fd);
  }
}

function missingFile(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function retainedOutput(path: string): boolean {
  try {
    lstatSync(join(path, ".user-output"));
    return true;
  } catch (error) {
    return !missingFile(error);
  }
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !(error instanceof Error && "code" in error && error.code === "ESRCH");
  }
}

function ownerPid(owner: unknown): number | null {
  if (!owner || typeof owner !== "object" || !("pid" in owner)) return null;
  const pid = owner.pid;
  return typeof pid === "number" && Number.isSafeInteger(pid) && pid > 0 ? pid : null;
}

function ordinaryOwner(stat: Stats): boolean {
  return stat.isFile() && stat.nlink === 1;
}

function sameOwnerFile(before: Stats, current: Stats): boolean {
  return current.dev === before.dev && current.ino === before.ino;
}

function openOwner(marker: string, access: number): number {
  const fd = openSync(marker, access | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const current = fstatSync(fd);
    const named = lstatSync(marker);
    if (!ordinaryOwner(current) || !ordinaryOwner(named) || !sameOwnerFile(named, current))
      throw new Error("Snapshot owner changed while opening.");
    return fd;
  } catch (error) {
    closeSync(fd);
    throw error;
  }
}

function readOwner(marker: string): unknown {
  const fd = openOwner(marker, constants.O_RDONLY);
  try {
    return JSON.parse(readFileSync(fd, "utf8"));
  } finally {
    closeSync(fd);
  }
}

function releasedOwner(owner: unknown): boolean {
  return (
    !!owner &&
    typeof owner === "object" &&
    "released" in owner &&
    owner.released === true &&
    ownerPid(owner) !== null
  );
}

function liveOwner(path: string): boolean {
  if (retainedOutput(path)) return true;
  try {
    const marker = join(path, OWNER);
    const owner = readOwner(marker);
    if (releasedOwner(owner)) return false;
    const pid = ownerPid(owner);
    return pid === null || processIsAlive(pid);
  } catch (error) {
    return !missingFile(error);
  }
}

function recordsOf(state: VideoState): ArtifactRecord[] {
  return [...Object.values(state.snapshots.revisions).flat(), ...state.snapshots.unversioned];
}

function containingRun(root: string, path: string | undefined): string | null {
  if (!path) return null;
  const name = relative(root, resolve(path)).split(sep)[0];
  return name && UUID.test(name) ? join(root, name) : null;
}

function keepContainingRun(keep: Set<string>, root: string, path: string | undefined): void {
  const run = containingRun(root, path);
  if (run) keep.add(run);
}

function protectedRuns(root: string, state: VideoState, records: ArtifactRecord[]): Set<string> {
  const keep = new Set<string>();
  for (const revision of [state.currentRevision, ...(state.renders?.retainedRevisions ?? [])]) {
    const latest = records
      .filter((record) => record.revision === revision && record.status !== "cleaned")
      .sort((a, b) => b.createdAt - a.createdAt)[0];
    keepContainingRun(keep, root, latest?.image);
  }
  const latest = records.find((record) => record.id === state.snapshots.latest?.id);
  keepContainingRun(keep, root, latest?.image);
  for (const item of state.pendingArtifactCleanup ?? []) keepContainingRun(keep, root, item.path);
  return keep;
}

function runsOnDisk(root: string) {
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isDirectory() && UUID.test(entry.name))
    .flatMap((entry) => {
      const path = join(root, entry.name);
      try {
        const stat = lstatSync(path);
        return [{ path, stat }];
      } catch {
        return [];
      }
    })
    .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs || a.path.localeCompare(b.path));
}

/** Called under the video-state lock; only managed, old, inactive UUID directories are disposable. */
export function planSnapshotCleanup(
  project: string,
  state: VideoState,
  now = Date.now(),
): SnapshotRun[] {
  const root = rootOf(project);
  if (!ordinaryPath(project, root)) return [];
  const records = recordsOf(state);
  const keep = protectedRuns(root, state, records);
  const runs = runsOnDisk(root);
  for (const run of runs.slice(0, SNAPSHOT_RUNS_TO_KEEP)) keep.add(run.path);
  const pending: SnapshotRun[] = [];
  for (const { path, stat } of runs) {
    if (keep.has(path) || now - stat.mtimeMs < SNAPSHOT_GRACE_MS || liveOwner(path)) continue;
    try {
      const run = { path, dev: stat.dev, ino: stat.ino, mtimeMs: stat.mtimeMs };
      if (!unchangedRun(project, run)) continue;
      pending.push(run);
      retireReferences(records, root, path);
    } catch {
      // Cleanup is opportunistic; a busy or unreadable run is retried on the next capture.
    }
  }
  return pending;
}

function retireReferences(records: ArtifactRecord[], root: string, path: string): void {
  for (const record of records) {
    if (containingRun(root, record.image) !== path) continue;
    delete record.image;
    record.status = "cleaned";
  }
}

function unchangedRun(project: string, run: SnapshotRun): boolean {
  if (!ordinaryPath(project, run.path)) return false;
  const current = lstatSync(run.path);
  return (
    current.isDirectory() &&
    current.dev === run.dev &&
    current.ino === run.ino &&
    current.mtimeMs === run.mtimeMs
  );
}

export interface SnapshotRun {
  path: string;
  dev: number;
  ino: number;
  mtimeMs: number;
}

/** Retire references durably before calling this. Failed removals are selected again next time. */
export function finishSnapshotCleanup(project: string, runs: readonly SnapshotRun[]): void {
  for (const run of runs) {
    try {
      if (!unchangedRun(project, run) || liveOwner(run.path)) continue;
      rmSync(run.path, { recursive: true });
    } catch {
      // Retired evidence is safe to retry on the next completed capture.
    }
  }
}

export function releaseSnapshotRun(project: string, path: string): void {
  const marker = join(path, OWNER);
  const expected = ownedMarkers.get(marker);
  if (!expected) return;
  try {
    if (dirname(path) !== rootOf(project) || !ordinaryPath(project, path)) return;
    const fd = openOwner(marker, constants.O_RDWR);
    try {
      if (!sameOwnerFile(expected, fstatSync(fd))) return;
      const owner: unknown = JSON.parse(readFileSync(fd, "utf8"));
      if (ownerPid(owner) !== process.pid) return;
      ftruncateSync(fd, 0);
      writeSync(fd, JSON.stringify({ version: 1, pid: process.pid, released: true }), 0, "utf8");
    } finally {
      closeSync(fd);
    }
  } catch {
    // A missing or unreadable lease must not fail a successful capture.
  } finally {
    ownedMarkers.delete(marker);
  }
}

/** Explicit outputs remain user evidence even when reusing a managed UUID folder. */
export function retainSnapshotOutput(project: string, path: string): void {
  const root = rootOf(project);
  const run = containingRun(root, path);
  if (!run) return;
  createSnapshotParents(project, resolve(path));
  try {
    writeFileSync(
      join(run, ".user-output"),
      "Explicit --output; retained until manual cleanup.\n",
      { flag: "wx" },
    );
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
  }
}
