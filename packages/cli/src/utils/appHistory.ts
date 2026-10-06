import { lstatSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { readRecord, recordChangedAt, writeRecord } from "./projectRecords.js";

// The desktop app records each chat turn in .hyperframes/ (hyperframes-internal appHistory.mjs), one JSON object
// a line. The seen record holds the newest turn shown here and when files were last checked; both start at the
// hand-off, so a project never handed over from this machine shows nothing.
export const APP_HISTORY = "app-history.jsonl";
const SEEN = "app-history-seen.json";
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

export function readAppTurns(dir: string): AppTurn[] {
  return readRecord(dir, APP_HISTORY, MAX_READ_BYTES)
    .split("\n")
    .flatMap((line) => toTurn(line) ?? []);
}

export interface Seen {
  /** The newest turn already shown; 0 when the project was never handed over from here. */
  at: number;
  /** When the project's files were last checked for changes. */
  checked: number;
}

const stamp = (value: unknown): number => (typeof value === "string" ? Date.parse(value) || 0 : 0);

export function readSeen(dir: string): Seen {
  try {
    const seen: Record<string, unknown> = Object(JSON.parse(readRecord(dir, SEEN, 4096)));
    const at = stamp(seen.at);
    return { at, checked: stamp(seen.checked) || at };
  } catch {
    return { at: 0, checked: 0 };
  }
}

/** False when it could not be written; the same turns then show again, never fewer. */
export const markSeen = (dir: string, seen: Seen): boolean =>
  writeRecord(
    dir,
    SEEN,
    JSON.stringify({
      at: new Date(seen.at).toISOString(),
      checked: new Date(seen.checked).toISOString(),
    }),
  );

export const unseenTurns = (dir: string, since: number): AppTurn[] =>
  since ? readAppTurns(dir).filter((turn) => Date.parse(turn.at) > since) : [];

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
      else if (entry.isFile() && lstatSync(path).mtimeMs > since)
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
    const { at } = readSeen(dir);
    if (!at || recordChangedAt(dir, APP_HISTORY) <= at) continue;
    const count = unseenTurns(dir, at).length;
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
