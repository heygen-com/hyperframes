import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { realpath } from "@hyperframes/core/safe-path";
import { homedir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { namedCacheDir } from "@hyperframes/core/cache-dir";
import { windowsLocalAppData } from "./windowsAppData.js";
import {
  readPlainFile,
  readRecord,
  readRecordTail,
  recordChangedAt,
  replaceFile,
} from "./projectRecords.js";

// The desktop app records each chat turn in .hyperframes/, one JSON object a line. The seen record holds the newest
// turn shown here, when files were last checked, and digests of the history lines this person has no news in. It
// starts at a hand-off and lives in this person's ~/.hyperframes, keyed by the project's real path, so a file a
// cloned repo ships can never claim one, and lines the history already held at the hand-off are never shown.
export const APP_HISTORY = "app-history.jsonl";
const MAX_READ_BYTES = 1024 * 1024;
const MAX_SEEN_BYTES = 2 * MAX_READ_BYTES;
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

/** The project folder noted at the hand-off, digests of the lines the history then held (null when too large to
 * note: nothing shows until the next hand-off), and digests of the lines shown since that it still holds. */
interface Known {
  folder: string;
  held: string[] | null;
  shown: string[];
}

/** Which folder is at `dir`: another one there since the hand-off is another project, with nothing to catch up on. */
function folderId(dir: string): string {
  try {
    const stats = statSync(dir, { bigint: true });
    return `${stats.dev}:${stats.ino}:${stats.birthtimeNs}`;
  } catch {
    return "";
  }
}

export interface Seen {
  /** The newest turn already shown; 0 when the project was never handed over from here. */
  at: number;
  /** When the project's files were last checked for changes. */
  checked: number;
  /** Absent in a record written before the history's lines were noted. */
  history?: Known;
}

const stamp = (value: unknown): number => (typeof value === "string" ? Date.parse(value) || 0 : 0);

const isDigests = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

function toKnown(value: unknown): Known | undefined {
  const { folder, held, shown } = Object(value) as Record<string, unknown>;
  if (typeof folder !== "string" || (held !== null && !isDigests(held)) || !isDigests(shown))
    return undefined;
  return { folder, held, shown };
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
    const seen: Record<string, unknown> = Object(
      JSON.parse(readPlainFile(seenPath(dir), MAX_SEEN_BYTES)),
    );
    const at = stamp(seen.at);
    const history = toKnown(seen.history);
    if (history && history.folder !== folderId(dir)) return { at: 0, checked: 0 };
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

const digest = (line: string): string =>
  createHash("sha256").update(line).digest("hex").slice(0, 16);

const digests = (lines: string[]): string[] => [...new Set(lines.map(digest))];

/** The history's whole lines; a line still being written, after the last newline, is `tail`. */
function historyLines(dir: string): { lines: string[]; tail: string; whole: boolean } {
  const read = readRecordTail(dir, APP_HISTORY, MAX_READ_BYTES);
  const parts = (read?.text ?? "").split("\n");
  const startsMidLine = read !== null && !read.whole;
  if (startsMidLine) parts.shift();
  const tail = parts.pop() ?? "";
  return { lines: parts.filter(Boolean), tail, whole: read?.whole ?? true };
}

interface Unseen {
  turns: AppTurn[];
  history?: Known;
}

/** Lines not held at the hand-off nor shown since, in the history's order, whatever rewrote the file. */
function knownTurns(dir: string, known: Known): Unseen {
  if (!known.held) return { turns: [] };
  const { lines } = historyLines(dir);
  const held = new Set(known.held);
  const old = new Set([...known.held, ...known.shown]);
  return {
    turns: lines.filter((line) => !old.has(digest(line))).flatMap((line) => toTurn(line) ?? []),
    history: { ...known, shown: digests(lines).filter((key) => !held.has(key)) },
  };
}

/** A record from before lines were noted: only when every turn is dated after `since`, those not after `now`. */
function datedTurns(dir: string, since: number, now: number): Unseen {
  const { lines } = historyLines(dir);
  const turns = lines.flatMap((line) => toTurn(line) ?? []);
  const allAfter = turns.every((turn) => Date.parse(turn.at) > since);
  return {
    turns: allAfter ? turns.filter((turn) => Date.parse(turn.at) <= now) : [],
    history: { folder: folderId(dir), held: digests(lines), shown: [] },
  };
}

/** The turns this person's app recorded since the hand-off or the last look, and what is then known. */
export function unseenTurns(dir: string, seen: Seen, now = Date.now()): Unseen {
  if (!seen.at) return { turns: [] };
  return seen.history ? knownTurns(dir, seen.history) : datedTurns(dir, seen.at, now);
}

/** A hand-off notes every line the history holds, unless one since the update already did. */
export function noteHandoff(dir: string, now = Date.now()): boolean {
  const seen = readSeen(dir);
  if (seen.at && seen.history?.held) return true;
  const { lines, tail, whole } = historyLines(dir);
  return markSeen(dir, {
    at: seen.at || now,
    checked: seen.at ? seen.checked : now,
    history: {
      folder: folderId(dir),
      held: whole ? digests(tail ? [...lines, tail] : lines) : null,
      shown: [],
    },
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
