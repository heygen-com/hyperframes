import { appendFileSync, readFileSync } from "node:fs";
import { replaceFileAtomically } from "../helpers/atomicFile.js";

export interface HistoryWho {
  kind: "person" | "agent" | "outside";
  /** Shown in the History list: "You", "Nib", "Codex", "Outside". */
  name: string;
}

/** A file's sha256 before and after; null is "did not exist", so a create or delete undoes like any edit. */
export interface HistoryFileChange {
  path: string;
  before: string | null;
  after: string | null;
}

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

type LogRecord =
  | { type: "baseline"; files: Record<string, string> }
  | { type: "entry"; entry: HistoryEntry }
  | { type: "pin"; id: string; pinned: boolean };

export function readLog(file: string): HistoryLog | null {
  let text: string;
  try {
    text = readFileSync(file, "utf-8");
  } catch {
    return null;
  }
  const log: HistoryLog = { baseline: new Map(), entries: [], pins: new Set() };
  for (const line of text.split("\n")) {
    // A torn last line from a crash mid-append is dropped; every line before it is whole.
    let record: LogRecord;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    applyRecord(log, record);
  }
  return log;
}

function applyRecord(log: HistoryLog, record: LogRecord): void {
  if (record.type === "baseline") log.baseline = new Map(Object.entries(record.files));
  else if (record.type === "entry") log.entries.push(record.entry);
  else if (record.pinned) log.pins.add(record.id);
  else log.pins.delete(record.id);
}

export function appendRecord(file: string, record: LogRecord): void {
  appendFileSync(file, `${JSON.stringify(record)}\n`);
}

export function writeLog(file: string, log: HistoryLog): void {
  const records: LogRecord[] = [
    { type: "baseline", files: Object.fromEntries(log.baseline) },
    ...log.entries.map((entry) => ({ type: "entry" as const, entry })),
    ...[...log.pins].map((id) => ({ type: "pin" as const, id, pinned: true })),
  ];
  replaceFileAtomically(file, records.map((r) => `${JSON.stringify(r)}\n`).join(""), 0o644);
}

export function applyEntry(manifest: Manifest, entry: HistoryEntry): void {
  for (const file of entry.files)
    if (file.after === null) manifest.delete(file.path);
    else manifest.set(file.path, file.after);
}

/** The files as they were right after `point`. Null when that point is no longer kept. */
export function manifestAt(log: HistoryLog, point: string): Manifest | null {
  const manifest = new Map(log.baseline);
  if (point === START) return manifest;
  for (const entry of log.entries) {
    applyEntry(manifest, entry);
    if (entry.id === point) return manifest;
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
 * What Cmd+Z (back) or Cmd+Shift+Z (forward) reverts, whoever made the change. Back: the newest change still in
 * effect. Forward: the newest undo of a change that is still in effect, while no change has been made since.
 */
export function stepTarget(
  entries: readonly HistoryEntry[],
  direction: "back" | "forward",
): HistoryEntry | undefined {
  const undone = undoneIds(entries);
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i]!;
    const isChange = !entry.undoes;
    if (direction === "back" && isChange && !undone.has(entry.id)) return entry;
    if (direction !== "forward") continue;
    if (isChange) return undefined;
    const target = byId.get(entry.undoes!);
    if (!undone.has(entry.id) && target && !target.undoes) return entry;
  }
  return undefined;
}

/**
 * Folds the oldest entry into the baseline unless it is pinned. ponytail: an old pin therefore holds everything
 * after it; per-point snapshots would lift that. Returns whether one was folded.
 */
export function foldOldest(log: HistoryLog): boolean {
  const oldest = log.entries[0];
  if (!oldest || log.pins.has(oldest.id)) return false;
  applyEntry(log.baseline, oldest);
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
