import { closeSync, constants, mkdirSync, openSync, readFileSync, writeSync } from "node:fs";
import { dirname } from "node:path";
import { replaceFileAtomically } from "../helpers/atomicFile.js";

export interface HistoryWho {
  kind: "person" | "agent" | "outside";
  /** Shown in the History list: "You", the agent's name, "Outside". */
  name: string;
}

/** A file's sha256 before and after; null is "did not exist", so a create or delete undoes like any edit. */
export interface HistoryFileChange {
  path: string;
  before: string | null;
  after: string | null;
}

export type HistoryEntrySide = "before" | "after";

export interface HistoryEntry {
  id: string;
  who: HistoryWho;
  label: string;
  startedAt: number;
  endedAt: number;
  files: HistoryFileChange[];
  /** Set on an undo: the entry it reverted. Redo is undoing the undo. */
  undoes?: string;
  /** Set on a restore: the point (an entry id, or START) the files were made equal to. */
  restoredTo?: string;
}

/** The point before the first kept entry. */
export const START = "start";

/** Path to hash. */
export type Manifest = Map<string, string>;

export interface HistoryLog {
  baseline: Manifest;
  entries: HistoryEntry[];
  pins: Set<string>;
}

export type LogRecord =
  | { type: "baseline"; files: Record<string, string> }
  | { type: "entry"; entry: HistoryEntry }
  | { type: "pin"; id: string; pinned: boolean };

function parseRecord(line: string): LogRecord | null {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

/** `onUnreadable` hears of a damaged line; a torn last line (a crash mid-append) is expected and dropped quietly. */
export function readLog(file: string, onUnreadable: (line: number) => void): HistoryLog | null {
  let text: string;
  try {
    text = readFileSync(file, "utf-8");
  } catch {
    return null;
  }
  const log: HistoryLog = { baseline: new Map(), entries: [], pins: new Set() };
  const lines = text.split("\n");
  lines.forEach((line, index) => {
    const record = line ? parseRecord(line) : null;
    if (record) applyRecord(log, record);
    else if (line && index < lines.length - 1) onUnreadable(index + 1);
  });
  return log;
}

function applyRecord(log: HistoryLog, record: LogRecord): void {
  if (record.type === "baseline") log.baseline = new Map(Object.entries(record.files));
  else if (record.type === "entry") log.entries.push(record.entry);
  else if (record.pinned) log.pins.add(record.id);
  else log.pins.delete(record.id);
}

/** Appends `record`, already applied to `log`; a log file that is gone is written whole, so a restart replays it. */
export function saveRecord(file: string, log: HistoryLog, record: LogRecord): void {
  let fd: number;
  try {
    // No O_CREAT: an append never creates a log that would lack its baseline.
    fd = openSync(file, constants.O_WRONLY | constants.O_APPEND);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return writeLog(file, log);
  }
  try {
    writeSync(fd, `${JSON.stringify(record)}\n`);
  } finally {
    closeSync(fd);
  }
}

export function writeLog(file: string, log: HistoryLog): void {
  const records: LogRecord[] = [
    { type: "baseline", files: Object.fromEntries(log.baseline) },
    ...log.entries.map((entry) => ({ type: "entry" as const, entry })),
    ...[...log.pins].map((id) => ({ type: "pin" as const, id, pinned: true })),
  ];
  mkdirSync(dirname(file), { recursive: true });
  replaceFileAtomically(file, records.map((r) => `${JSON.stringify(r)}\n`).join(""), 0o644);
}

function applyEntry(manifest: Manifest, entry: HistoryEntry, side: HistoryEntrySide): void {
  for (const file of entry.files) {
    const hash = file[side];
    if (hash === null) manifest.delete(file.path);
    else manifest.set(file.path, hash);
  }
}

/** The files as they were right after `point`. Null when that point is no longer kept. */
export function manifestAt(log: HistoryLog, point: string): Manifest | null {
  return point === START ? new Map(log.baseline) : manifestAround(log, point, "after");
}

/** Entry `id`'s own files as it found (`before`) or left (`after`) them; the rest as earlier entries left them. */
export function manifestAround(
  log: HistoryLog,
  id: string,
  side: HistoryEntrySide,
): Manifest | null {
  const manifest = new Map(log.baseline);
  for (const entry of log.entries) {
    applyEntry(manifest, entry, entry.id === id ? side : "after");
    if (entry.id === id) return manifest;
  }
  return null;
}

/** Entries currently reverted: an undo that is itself in effect reverts its target. */
export function undoneIds(entries: readonly HistoryEntry[]): Set<string> {
  const undone = new Set<string>();
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i]!;
    if (entry.undoes && !undone.has(entry.id)) undone.add(entry.undoes);
  }
  return undone;
}

/**
 * What Cmd+Z (back) or Cmd+Shift+Z (forward) reverts for `mine`. Back: the newest change `mine` owns that is still
 * in effect. Forward: the newest of `mine`'s undos still in effect, while `mine` has made no change since.
 */
export function stepTarget(
  entries: readonly HistoryEntry[],
  direction: "back" | "forward",
  mine: (entry: HistoryEntry) => boolean,
): HistoryEntry | undefined {
  const undone = undoneIds(entries);
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const owns = ownerOf(entries, byId, mine);
  const newestFirst = [...entries].reverse();
  if (direction === "back")
    return newestFirst.find((entry) => !entry.undoes && !undone.has(entry.id) && owns(entry));
  for (const entry of newestFirst) {
    if (!entry.undoes) {
      if (owns(entry)) return undefined;
      continue;
    }
    const target = byId.get(entry.undoes);
    if (mine(entry) && !undone.has(entry.id) && target && !target.undoes) return entry;
  }
  return undefined;
}

/** A change is yours to step over if you made it, or your redo is what brought it back. */
function ownerOf(
  entries: readonly HistoryEntry[],
  byId: ReadonlyMap<string, HistoryEntry>,
  mine: (entry: HistoryEntry) => boolean,
): (entry: HistoryEntry) => boolean {
  const redoneBy = new Map<string, HistoryEntry>();
  for (const entry of entries) {
    const target = entry.undoes ? byId.get(entry.undoes) : undefined;
    if (target?.undoes) redoneBy.set(target.undoes, entry);
  }
  return (entry) => mine(entry) || mine(redoneBy.get(entry.id) ?? entry);
}

/**
 * Folds the oldest entry into the baseline unless it is pinned. ponytail: an old pin therefore holds everything
 * after it; per-point snapshots would lift that. Returns whether one was folded.
 */
export function foldOldest(log: HistoryLog): boolean {
  const oldest = log.entries[0];
  if (!oldest || log.pins.has(oldest.id)) return false;
  applyEntry(log.baseline, oldest, "after");
  log.entries.shift();
  return true;
}

/** Every hash a kept point can still need. */
export function referencedHashes(log: HistoryLog, current: Manifest): Set<string> {
  const keep = new Set([...log.baseline.values(), ...current.values()]);
  for (const entry of log.entries)
    for (const file of entry.files) {
      if (file.before) keep.add(file.before);
      if (file.after) keep.add(file.after);
    }
  return keep;
}
