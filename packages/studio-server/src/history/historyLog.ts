import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
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
  if (existsSync(file)) appendFileSync(file, `${JSON.stringify(record)}\n`);
  else writeLog(file, log);
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

function applyEntry(manifest: Manifest, entry: HistoryEntry): void {
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
