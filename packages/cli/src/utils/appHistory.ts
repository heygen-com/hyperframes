import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, readdirSync } from "node:fs";
import { realpath } from "@hyperframes/core/safe-path";
import { homedir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { namedCacheDir } from "@hyperframes/core/cache-dir";
import { windowsLocalAppData } from "./windowsAppData.js";
import {
  type PlainBytes,
  readPlainFile,
  readRecord,
  readRecordBytes,
  recordChangedAt,
  recordFiles,
  replaceFile,
} from "./projectRecords.js";

// The desktop app records each chat turn in .hyperframes/, one JSON object a line, appended. The seen record holds
// the newest turn shown here, when files were last checked, and how far into the history file this person has
// read. It starts at a hand-off and lives in this person's ~/.hyperframes, keyed by the project's real path, so a
// file a cloned repo ships can never claim one, and lines the history already held at the hand-off are never shown.
export const APP_HISTORY = "app-history.jsonl";
const MAX_READ_BYTES = 1024 * 1024;
const MAX_FIELD_CHARS = 2000;
const MAX_WALKED_FILES = 5000;
const SKIPPED_DIRS = new Set(["node_modules", "renders", "snapshots"]);

export interface AppTurn {
  at: string;
  engine: string;
  asked: string;
  did: string;
  files: string[];
}

const text = (value: unknown): string =>
  typeof value === "string" ? value.slice(0, MAX_FIELD_CHARS) : "";

function toTurn(line: string): AppTurn | null {
  let raw: Record<string, unknown>;
  try {
    raw = Object(JSON.parse(line));
  } catch {
    return null;
  }
  const at = text(raw.at);
  if (Number.isNaN(Date.parse(at))) return null;
  const files = Array.isArray(raw.files) ? raw.files.map(text).filter(Boolean) : [];
  return { at, engine: text(raw.engine), asked: text(raw.asked), did: text(raw.did), files };
}

const turnsIn = (text: string): AppTurn[] => text.split("\n").flatMap((line) => toTurn(line) ?? []);

export function readAppTurns(dir: string): AppTurn[] {
  return turnsIn(readRecord(dir, APP_HISTORY, MAX_READ_BYTES));
}

/** The history file ("dev:ino", "" for none), its bytes already read, and the digest of the last line shown. */
interface HistoryMark {
  file: string;
  size: number;
  line?: string;
}

export interface Seen {
  /** The newest turn already shown; 0 when the project was never handed over from here. */
  at: number;
  /** When the project's files were last checked for changes. */
  checked: number;
  /** Absent in a record written before the history was marked. */
  history?: HistoryMark;
}

const stamp = (value: unknown): number => (typeof value === "string" ? Date.parse(value) || 0 : 0);

function toMark(value: unknown): HistoryMark | undefined {
  const { file, size, line } = Object(value) as Record<string, unknown>;
  if (typeof file !== "string" || typeof size !== "number") return undefined;
  if (!Number.isSafeInteger(size) || size < 0) return undefined;
  return typeof line === "string" ? { file, size, line } : { file, size };
}

export function seenPath(dir: string): string {
  let real: string;
  try {
    real = realpath(dir);
  } catch {
    real = resolve(dir);
  }
  const key = createHash("sha256").update(real).digest("hex").slice(0, 32);
  const base = windowsLocalAppData();
  return join(
    namedCacheDir("catch-up") ??
      join(base ? join(base, "hyperframes") : join(homedir(), ".hyperframes"), "catch-up"),
    `${key}.json`,
  );
}

export function readSeen(dir: string): Seen {
  try {
    const seen: Record<string, unknown> = Object(JSON.parse(readPlainFile(seenPath(dir), 4096)));
    const at = stamp(seen.at);
    const history = toMark(seen.history);
    return { at, checked: stamp(seen.checked) || at, ...(history && { history }) };
  } catch {
    return { at: 0, checked: 0 };
  }
}

/** False when it could not be written; the same turns then show again, never fewer. */
export function markSeen(dir: string, seen: Seen): boolean {
  const path = seenPath(dir);
  const at = (time: number) => new Date(time).toISOString();
  try {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  } catch {
    return false;
  }
  const record = { at: at(seen.at), checked: at(seen.checked), history: seen.history };
  return replaceFile(path, JSON.stringify(record), 0o600);
}

const digest = (line: Buffer): string => createHash("sha256").update(line).digest("hex");

interface Line {
  bytes: Buffer;
  endsAt: number;
}

/** The whole lines of `read` from the byte `from` on, and the byte after the last of them. */
function wholeLines(read: PlainBytes, from: number): { lines: Line[]; end: number } {
  let at = Math.max(0, from - read.start);
  // Read from partway into a line: that line is not whole.
  if (from < read.start) at = read.bytes.indexOf(0x0a) + 1 || read.bytes.length;
  const lines: Line[] = [];
  for (let next = read.bytes.indexOf(0x0a, at); next !== -1; next = read.bytes.indexOf(0x0a, at)) {
    if (next > at)
      lines.push({ bytes: read.bytes.subarray(at, next), endsAt: read.start + next + 1 });
    at = next + 1;
  }
  return { lines, end: read.start + at };
}

function afterLine(read: PlainBytes, line: string): number | null {
  const found = wholeLines(read, read.start).lines.filter((whole) => digest(whole.bytes) === line);
  return found.at(-1)?.endsAt ?? null;
}

const grewFrom = (read: PlainBytes | null, mark: HistoryMark): boolean =>
  (!mark.file || mark.file === read?.file) && (read?.size ?? 0) >= mark.size;

const setAside = (dir: string, file: string): boolean =>
  [...recordFiles(dir)].some(
    ([name, held]) => name !== APP_HISTORY && name.startsWith("app-history.") && held === file,
  );

/** Past the marked bytes, past the last line shown once the app trimmed the history, or from the start of the one
 * it began after setting the marked file aside. Null for a history replaced or cut short: nothing until a hand-off. */
function unseenStart(dir: string, read: PlainBytes | null, mark: HistoryMark): number | null {
  if (grewFrom(read, mark)) return mark.size;
  const found = read && mark.line ? afterLine(read, mark.line) : null;
  if (found !== null) return found;
  return mark.file && setAside(dir, mark.file) ? 0 : null;
}

function markedTurns(dir: string, mark: HistoryMark): Unseen {
  const read = readRecordBytes(dir, APP_HISTORY, MAX_READ_BYTES);
  const start = unseenStart(dir, read, mark);
  if (start === null) return { turns: [] };
  if (!read) return { turns: [], history: mark };
  const { lines, end } = wholeLines(read, start);
  const last = lines.at(-1);
  const line = last ? digest(last.bytes) : mark.line;
  return {
    turns: lines.flatMap((whole) => toTurn(whole.bytes.toString("utf8")) ?? []),
    history: { file: read.file, size: end, ...(line && { line }) },
  };
}

/** A record from before the history was marked: turns dated after `since`, not after `now`; then marked at its end. */
function datedTurns(dir: string, since: number, now: number): Unseen {
  const read = readRecordBytes(dir, APP_HISTORY, MAX_READ_BYTES);
  const turns = turnsIn(read?.bytes.toString("utf8") ?? "").filter(
    (turn) => Date.parse(turn.at) > since && Date.parse(turn.at) <= now,
  );
  const size = read ? wholeLines(read, read.start).end : 0;
  return { turns, history: { file: read?.file ?? "", size } };
}

interface Unseen {
  turns: AppTurn[];
  /** Absent when the history is not the one marked. */
  history?: HistoryMark;
}

/** The turns this person's app recorded since the hand-off or the last look, and where the history then stands. */
export function unseenTurns(dir: string, seen: Seen, now = Date.now()): Unseen {
  if (!seen.at) return { turns: [] };
  return seen.history ? markedTurns(dir, seen.history) : datedTurns(dir, seen.at, now);
}

/** The first hand-off from here, or one after the marked history was replaced, marks the history as it is now. */
export function noteHandoff(dir: string, now = Date.now()): boolean {
  const seen = readSeen(dir);
  if (seen.at && (!seen.history || unseenTurns(dir, seen).history)) return true;
  const read = readRecordBytes(dir, APP_HISTORY, 0);
  return markSeen(dir, {
    at: seen.at || now,
    checked: seen.at ? seen.checked : now,
    history: { file: read?.file ?? "", size: read?.size ?? 0 },
  });
}

function isChangedFile(path: string, since: number): boolean {
  try {
    const stats = lstatSync(path);
    return stats.isFile() && stats.mtimeMs > since;
  } catch {
    return false;
  }
}

/** Project files changed after `since`, by the app or by hand; hidden folders and outputs are not the video. */
export function filesChangedSince(dir: string, since: number): string[] {
  const changed: string[] = [];
  let walked = 0;
  const walk = (folder: string): void => {
    let entries;
    try {
      entries = readdirSync(folder, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (walked++ > MAX_WALKED_FILES) return;
      if (entry.name.startsWith(".") || SKIPPED_DIRS.has(entry.name)) continue;
      const path = join(folder, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile() && isChangedFile(path, since))
        changed.push(relative(dir, path).split(sep).join("/"));
    }
  };
  walk(dir);
  return changed.sort();
}

/** The project a command ran on: its folder or a file in it, as given on the command line or the working folder. */
function projectsNamed(cwd: string, args: string[]): string[] {
  const candidates = [cwd, ...args.filter((arg) => !arg.startsWith("-"))].flatMap((arg) => {
    const path = resolve(cwd, arg);
    return [path, dirname(path)];
  });
  return [...new Set(candidates)];
}

/** One line for the end of any command run on a project the app has chatted about since it was last looked at. */
export function appHistoryNotice(cwd: string, args: string[]): string | null {
  for (const dir of projectsNamed(cwd, args)) {
    const seen = readSeen(dir);
    if (!seen.at || recordChangedAt(dir, APP_HISTORY) <= seen.at) continue;
    const count = unseenTurns(dir, seen).turns.length;
    if (count === 0) continue;
    const where = relative(cwd, dir);
    const turns = count === 1 ? "1 chat turn" : `${count} chat turns`;
    return (
      `The HyperFrames desktop app has ${turns} on this project you haven't seen. ` +
      `Run \`npx hyperframes catch-up${where ? ` ${where}` : ""}\` before changing it.`
    );
  }
  return null;
}

// The line scaffolded CLAUDE.md and AGENTS.md carry (templates/_shared); a test keeps the two the same.
export const CATCH_UP_NOTE =
  "> **Back from the desktop app.** Once this project was opened in the HyperFrames desktop app, run " +
  "`npx hyperframes catch-up` before your next change here: it lists what the person asked Framey in the app " +
  "and which files changed since.";
const SCAFFOLD_TITLE = "# HyperFrames Composition Project";
const AFTER = "> alive through review, and stop it explicitly with `preview --stop` afterward.\n";

/** On a hand-off, a project scaffolded before catch-up existed gains its line, so an agent that reads the
 * project's instructions catches up. Any other file, a link, or one that has the line stays as it is. */
export function addCatchUpNote(dir: string): void {
  for (const name of ["CLAUDE.md", "AGENTS.md"]) {
    const path = join(dir, name);
    try {
      const text = readPlainFile(path, MAX_READ_BYTES);
      if (!text.startsWith(SCAFFOLD_TITLE) || text.includes("hyperframes catch-up")) continue;
      const next = text.includes(AFTER)
        ? text.replace(AFTER, `${AFTER}\n${CATCH_UP_NOTE}\n`)
        : `${text.trimEnd()}\n\n${CATCH_UP_NOTE}\n`;
      replaceFile(path, next, lstatSync(path).mode & 0o777);
    } catch {
      // No such file: nothing to add to.
    }
  }
}
