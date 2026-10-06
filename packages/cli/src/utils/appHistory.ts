import {
  closeSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

// The desktop app records each chat turn here (hyperframes-internal appHistory.mjs), one JSON object a line.
export const APP_HISTORY_FILE = join(".hyperframes", "app-history.jsonl");
// When this project was handed to the app or last caught up on; turns and edits after it are new.
const SEEN_FILE = join(".hyperframes", "app-history-seen.json");
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

/** The file's last MAX_READ_BYTES, read only when it is a plain file: never a link or a device. */
function readTail(path: string): string {
  let fd: number;
  try {
    if (!lstatSync(path).isFile()) return "";
    fd = openSync(path, "r");
  } catch {
    return "";
  }
  try {
    const size = fstatSync(fd).size;
    const length = Math.min(size, MAX_READ_BYTES);
    const buffer = Buffer.alloc(length);
    readSync(fd, buffer, 0, length, size - length);
    return buffer.toString("utf8");
  } finally {
    closeSync(fd);
  }
}

export function readAppTurns(dir: string): AppTurn[] {
  return readTail(join(dir, APP_HISTORY_FILE))
    .split("\n")
    .flatMap((line) => toTurn(line) ?? []);
}

/** 0 when the project was never handed over or caught up on here. */
export function seenAt(dir: string): number {
  try {
    const seen: unknown = JSON.parse(readFileSync(join(dir, SEEN_FILE), "utf8"));
    const at = typeof seen === "object" && seen !== null && "at" in seen ? seen.at : null;
    return typeof at === "string" ? Date.parse(at) || 0 : 0;
  } catch {
    return 0;
  }
}

export function markSeen(dir: string, at: Date = new Date()): void {
  try {
    mkdirSync(join(dir, ".hyperframes"), { recursive: true });
    writeFileSync(join(dir, SEEN_FILE), JSON.stringify({ at: at.toISOString() }));
  } catch {
    // A read-only project just shows the same turns again next time.
  }
}

export const unseenTurns = (dir: string, since = seenAt(dir)): AppTurn[] =>
  readAppTurns(dir).filter((turn) => Date.parse(turn.at) > since);

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
    const count = unseenTurns(dir).length;
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
