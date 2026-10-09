import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, readdirSync } from "node:fs";
import { realpath } from "@hyperframes/core/safe-path";
import { homedir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { readPlainFile, readRecord, recordChangedAt, replaceFile } from "./projectRecords.js";

// The desktop app records each chat turn in .hyperframes/ (hyperframes-internal appHistory.mjs), one JSON object
// a line. The seen record holds the newest turn shown here and when files were last checked. It starts at a
// hand-off and lives in this person's ~/.hyperframes, keyed by the project's real path, so a file a cloned repo
// ships can never claim one.
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

function seenPath(dir: string): string {
  let real: string;
  try {
    real = realpath(dir);
  } catch {
    real = resolve(dir);
  }
  const key = createHash("sha256").update(real).digest("hex").slice(0, 32);
  return join(homedir(), ".hyperframes", "catch-up", `${key}.json`);
}

export function readSeen(dir: string): Seen {
  try {
    const seen: Record<string, unknown> = Object(JSON.parse(readPlainFile(seenPath(dir), 4096)));
    const at = stamp(seen.at);
    return { at, checked: stamp(seen.checked) || at };
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
  return replaceFile(path, JSON.stringify({ at: at(seen.at), checked: at(seen.checked) }), 0o600);
}

/** Turns after `since` and not after `now`: a turn dated ahead, as a cloned history could carry, is never shown and
 * never moves the cursor past real ones. */
export function unseenTurns(dir: string, since: number, now = Date.now()): AppTurn[] {
  if (!since) return [];
  return readAppTurns(dir).filter(
    (turn) => Date.parse(turn.at) > since && Date.parse(turn.at) <= now,
  );
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
