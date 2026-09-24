import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { defineCommand, type ArgsDef } from "citty";
import {
  DEFAULT_HISTORY_ROOT,
  HISTORY_START,
  openProjectHistory,
  type HistoryEntry,
  type HistoryListItem,
  type HistoryResult,
  type HistoryWho,
} from "@hyperframes/studio-server";
import type { Example } from "./_examples.js";
import { trackHistoryAction } from "../telemetry/events.js";
import { setCommandExitCode } from "../utils/commandResult.js";
import { resolveProject } from "../utils/project.js";
import { findPreviewServerForProject, studioApiUrl } from "../utils/studioSelectionClient.js";
import { withMeta } from "../utils/updateCheck.js";

export const examples: Example[] = [
  [
    "What changed since your last turn, and who changed it",
    "hyperframes history --since mine --who claude",
  ],
  [
    "Label your writes as one entry",
    "hyperframes history begin --who claude --label 'Bigger title'",
  ],
  ["Undo your newest entry after a failed check", "hyperframes history undo --who claude"],
];

type UndoMode = "just-this" | "back-to-before";

/** An agent's turn: its writes until `end` are one entry of its own. */
interface Turn {
  via: "preview" | "direct";
  id: string;
  who: HistoryWho;
  label: string;
  startedAt: number;
}

/** Whoever holds the project's history: a running preview (over its routes) or this process (the engine). */
interface Owner {
  via: "preview" | "direct";
  list(): Promise<HistoryListItem[]>;
  peek(point: string): Promise<Record<string, string> | null>;
  blob(hash: string): Promise<Buffer>;
  undo(id: string, who: HistoryWho, mode?: UndoMode): Promise<HistoryResult>;
  restore(point: string, who: HistoryWho): Promise<HistoryEntry | null>;
  pin(id: string, pinned: boolean): Promise<void>;
  begin(who: HistoryWho, label: string): Promise<string>;
  end(id: string): Promise<HistoryEntry | null>;
  close(): Promise<void>;
}

/** Swapped by tests. */
export const historyDeps = {
  historyRoot: DEFAULT_HISTORY_ROOT,
  findServer: (projectDir: string) => findPreviewServerForProject(projectDir),
};

/** The preview's window cap: a turn with no write for this long ends by itself. */
const TURN_IDLE_MS = 10 * 60_000;
const YOU: HistoryWho = { kind: "person", name: "You" };

class Refusal extends Error {}

const turnFile = (dir: string) => join(dir, ".hyperframes", "history-turn.json");

function readTurn(dir: string): Turn | null {
  try {
    return JSON.parse(readFileSync(turnFile(dir), "utf-8")) as Turn;
  } catch {
    return null;
  }
}

function writeTurn(dir: string, turn: Turn | null): void {
  if (!turn) return rmSync(turnFile(dir), { force: true });
  mkdirSync(dirname(turnFile(dir)), { recursive: true });
  writeFileSync(turnFile(dir), JSON.stringify(turn));
}

function previewOwner(route: (path: string) => string): Owner {
  const call = async (path: string, body?: object) => {
    const init = body && {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    };
    const response = await fetch(route(path), init);
    if (response.ok) return response;
    const error = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Refusal(error?.error ?? `The preview answered ${response.status}.`);
  };
  const json = async (path: string, body?: object) => (await call(path, body)).json();
  const list = async () => (await json("")).entries as HistoryListItem[];
  return {
    via: "preview",
    list,
    peek: async (point) => (await json(`/peek/${encodeURIComponent(point)}`)).files,
    blob: async (hash) => Buffer.from(await (await call(`/blob/${hash}`)).arrayBuffer()),
    undo: (id, who, mode) => json("/undo", { entryId: id, who, mode }),
    restore: (point, who) => json("/restore", { point, who }),
    pin: async (id, pinned) => void (await json("/pin", { entryId: id, pinned })),
    begin: async (who, label) =>
      (await json("/window", { who, label, idleMs: TURN_IDLE_MS })).windowId,
    // A preview restarted since begin committed the window on its way down.
    end: (id) =>
      json(`/window/${id}/close`, {})
        .then((closed) => closed.entry as HistoryEntry | null)
        .catch(async () => (await list()).find((entry) => entry.id === id) ?? null),
    close: async () => {},
  };
}

async function directOwner(projectDir: string, turn: Turn | null): Promise<Owner> {
  const history = await openProjectHistory({
    projectDir,
    historyRoot: historyDeps.historyRoot,
    // A turn begun through a preview that has since stopped is still the agent's.
    ...(turn && { closedWindow: turn }),
  });
  return {
    via: "direct",
    list: async () => history.list(),
    peek: async (point) => history.peek(point),
    blob: (hash) => history.readBlob(hash),
    undo: (id, who, mode) => history.undo(id, { who, ...(mode && { mode }) }),
    restore: (point, who) => history.restore(point, who),
    pin: async (id, pinned) => history.pin(id, pinned),
    // Opening filed every earlier write; the turn's own writes are filed to it when the next open passes it.
    begin: async () => randomUUID(),
    end: async (id) => history.list().find((entry) => entry.id === id) ?? null,
    close: () => history.close(),
  };
}

/** One owner: a preview that keeps this project's history, else the engine, which refuses a second opener. */
async function connect(projectDir: string, turn: Turn | null): Promise<Owner> {
  const server = await historyDeps.findServer(projectDir);
  if (server) {
    const route = (path: string) => studioApiUrl(server, `history${path}`);
    // 404: a preview that keeps no history.
    if ((await fetch(route(""))).status !== 404) return previewOwner(route);
  }
  return directOwner(projectDir, turn);
}

/**
 * Runs `task` with the project's history. A direct open files an open turn's writes so far as its entry, so the
 * turn goes on under a fresh id. ponytail: with no preview, a command mid-turn splits the turn in two entries.
 */
async function withOwner<T>(
  action: string,
  dir: string | undefined,
  task: (owner: Owner, turn: Turn | null, projectDir: string) => Promise<T>,
): Promise<T> {
  const { dir: projectDir } = resolveProject(dir, { requireIndex: false });
  const turn = readTurn(projectDir);
  const owner = await connect(projectDir, turn);
  trackHistoryAction({ action, via: owner.via });
  try {
    return await task(owner, turn, projectDir);
  } finally {
    await owner.close();
    if (owner.via === "direct" && turn && readTurn(projectDir)?.id === turn.id)
      writeTurn(projectDir, { ...turn, via: "direct", id: randomUUID() });
  }
}

/** An agent names itself with --who; without it the caller is the person, even during an agent's turn. */
const whoOf = (name: string | undefined): HistoryWho => (name ? { kind: "agent", name } : YOU);

const short = (id: string) => id.slice(0, 8);

function lastIndex<T>(items: readonly T[], match: (item: T) => boolean): number {
  for (let index = items.length - 1; index >= 0; index -= 1) if (match(items[index]!)) return index;
  return -1;
}

/** An entry id or a unique prefix of one. */
function entryOf(entries: readonly HistoryListItem[], ref: string): HistoryListItem {
  const found = entries.filter((entry) => entry.id.startsWith(ref));
  if (found.length === 1) return found[0]!;
  throw new Refusal(
    found.length ? `"${ref}" matches ${found.length} entries` : `No entry "${ref}" in this history`,
  );
}

/** A time, when `ref` is no entry id (a date like 2026-09-24 also reads as hex). */
function timeOf(entries: readonly HistoryListItem[], ref: string): number | null {
  const time = Date.parse(ref);
  return Number.isNaN(time) || entries.some((entry) => entry.id.startsWith(ref)) ? null : time;
}

/** A point is START, an entry id, or a time (the files right after the newest entry by then). */
function pointOf(entries: readonly HistoryListItem[], ref: string): string {
  if (ref === HISTORY_START) return ref;
  const time = timeOf(entries, ref);
  if (time === null) return entryOf(entries, ref).id;
  return entries[lastIndex(entries, (entry) => entry.endedAt <= time)]?.id ?? HISTORY_START;
}

function since(entries: HistoryListItem[], ref: string, who: HistoryWho): HistoryListItem[] {
  if (ref === "mine")
    return entries.slice(lastIndex(entries, (entry) => entry.who.name === who.name) + 1);
  const time = timeOf(entries, ref);
  if (time !== null) return entries.filter((entry) => entry.endedAt > time);
  return entries.slice(entries.indexOf(entryOf(entries, ref)) + 1);
}

function ago(at: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86_400)}d ago`;
}

function line(entry: HistoryListItem | HistoryEntry): string {
  const paths = entry.files.map((file) => file.path);
  const files = paths.slice(0, 2).join(", ") + (paths.length > 2 ? ` +${paths.length - 2}` : "");
  const flags =
    "undone" in entry ? `${entry.undone ? " [undone]" : ""}${entry.pinned ? " [pinned]" : ""}` : "";
  return `${short(entry.id)}  ${ago(entry.endedAt)}  ${entry.who.name}  ${entry.label}  (${files})${flags}`;
}

/** The agreed entry shape shared with the Desktop tools: files as paths. */
const publicEntry = (entry: HistoryListItem) => ({
  id: entry.id,
  who: entry.who,
  label: entry.label,
  startedAt: entry.startedAt,
  endedAt: entry.endedAt,
  files: entry.files.map((file) => file.path),
  undone: entry.undone,
  pinned: entry.pinned,
});

function print(json: boolean, data: object, text: string): void {
  console.log(json ? JSON.stringify(withMeta(data), null, 2) : text);
}

async function textDiff(owner: Owner, entry: HistoryEntry): Promise<string> {
  const work = mkdtempSync(join(tmpdir(), "hf-history-diff-"));
  try {
    const out: string[] = [];
    for (const file of entry.files) {
      const sides = await Promise.all(
        [file.before, file.after].map((hash) => (hash ? owner.blob(hash) : Buffer.alloc(0))),
      );
      if (sides.some((bytes) => bytes.subarray(0, 8000).includes(0))) {
        out.push(`Binary ${file.path} changed`);
        continue;
      }
      const [a, b] = ["a", "b"].map((side, index) => {
        const path = join(side, file.path);
        mkdirSync(dirname(join(work, path)), { recursive: true });
        writeFileSync(join(work, path), sides[index]!);
        return path;
      });
      const diff = spawnSync("git", ["diff", "--no-index", "--no-color", "--no-prefix", a!, b!], {
        cwd: work,
        encoding: "utf-8",
      });
      if (diff.error) throw new Refusal("--diff needs git on PATH");
      out.push(diff.stdout.trimEnd());
    }
    return out.join("\n");
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

function conflictText(entry: HistoryListItem, newer: HistoryListItem[], files: string[]): string {
  const id = short(entry.id);
  return [
    `${files.join(", ")} changed since "${entry.label}". Newer entries:`,
    ...newer.map((later) => `  ${line(later)}`),
    `Choose one:`,
    `  hyperframes history undo ${id} --just-this       put back only its files, over the newer edits to them`,
    `  hyperframes history undo ${id} --back-to-before  go back to before it, undoing the newer entries too`,
  ].join("\n");
}

async function runUndo(args: {
  ref?: string;
  who?: string;
  justThis?: boolean;
  backToBefore?: boolean;
  dir?: string;
  json: boolean;
}): Promise<void> {
  const mode: UndoMode | undefined = args.justThis
    ? "just-this"
    : args.backToBefore
      ? "back-to-before"
      : undefined;
  await withOwner("undo", args.dir, async (owner, turn, projectDir) => {
    const who = whoOf(args.who);
    // Undo ends the caller's own open turn first, so the turn is an entry that can be undone.
    if (turn?.who.name === who.name) {
      await owner.end(turn.id);
      writeTurn(projectDir, null);
    }
    const entries = await owner.list();
    const entry = args.ref
      ? entryOf(entries, args.ref)
      : entries[lastIndex(entries, (e) => e.who.name === who.name && !e.undone && !e.undoes)];
    if (!entry) throw new Refusal(`${who.name} has no entry still in effect`);
    const result = await owner.undo(entry.id, who, mode);
    if (result.ok)
      return print(
        args.json,
        result,
        result.entry ? `Undid ${short(entry.id)}: ${line(result.entry)}` : "Nothing to undo.",
      );
    setCommandExitCode(2);
    const newer = result.conflict.newer.map((id) => entryOf(entries, id));
    print(args.json, result, conflictText(entry, newer, result.conflict.files));
  });
}

/** Refusals are the user's to fix: one line (or JSON) and exit 2, never a stack. */
function guarded<A>(run: (args: A) => Promise<void>) {
  return async (args: A) => {
    try {
      await run(args);
    } catch (error) {
      if (!(error instanceof Refusal) && (error as Error).name !== "HistoryBusyError") throw error;
      setCommandExitCode(2);
      const json = (args as { json?: boolean }).json;
      console.error(
        json
          ? JSON.stringify({ ok: false, reason: (error as Error).message })
          : (error as Error).message,
      );
    }
  };
}

const common = {
  dir: { type: "string", description: "Project directory (default: current)" },
  json: { type: "boolean", description: "Output as JSON", default: false },
} as const;

const sub = <A>(
  name: string,
  description: string,
  args: ArgsDef,
  run: (args: A) => Promise<void>,
) =>
  defineCommand({
    meta: { name, description },
    args: { ...common, ...args },
    run: ({ args: parsed }) => guarded(run)(parsed as A),
  });

const listEntries = async (args: {
  _?: string[];
  since?: string;
  who?: string;
  limit?: string;
  dir?: string;
  json: boolean;
}) => {
  if (args._?.[0]) return;
  await withOwner("list", args.dir, async (owner) => {
    const all = await owner.list();
    const picked = args.since ? since(all, args.since, whoOf(args.who)) : all;
    const limit = Number(args.limit ?? 20);
    const shown = picked.slice(-limit).reverse();
    const more = picked.length - shown.length;
    const text = shown.map(line).join("\n") || "No changes recorded.";
    print(
      args.json,
      { entries: shown.map(publicEntry) },
      more ? `${text}\n(${more} older; --limit)` : text,
    );
  });
};

export default defineCommand({
  meta: { name: "history", description: "List, undo and restore the project's recorded changes" },
  args: {
    ...common,
    since: { type: "string", description: "Only entries after an entry id, a time, or 'mine'" },
    who: { type: "string", description: "Your name, for --since mine" },
    limit: { type: "string", description: "Newest entries to show (default 20)" },
  },
  subCommands: {
    show: () =>
      sub<{ ref: string; diff: boolean; dir?: string; json: boolean }>(
        "show",
        "One entry's files, before and after",
        { ref: { type: "positional", required: true }, diff: { type: "boolean", default: false } },
        (args) =>
          withOwner("show", args.dir, async (owner) => {
            const entry = entryOf(await owner.list(), args.ref);
            const marks = entry.files.map(
              (file) =>
                `  ${file.before === null ? "A" : file.after === null ? "D" : "M"} ${file.path}`,
            );
            const body = args.diff ? await textDiff(owner, entry) : marks.join("\n");
            print(args.json, { entry }, `${line(entry)}\n${body}`);
          }),
      ),
    undo: () =>
      sub(
        "undo",
        "Undo an entry (default: your newest one still in effect)",
        {
          ref: { type: "positional", required: false },
          who: { type: "string", description: "Your name" },
          "just-this": { type: "boolean", default: false },
          "back-to-before": { type: "boolean", default: false },
        },
        runUndo,
      ),
    restore: () =>
      sub<{ ref: string; who?: string; dir?: string; json: boolean }>(
        "restore",
        "Make the files what they were right after an entry, a time, or 'start'",
        { ref: { type: "positional", required: true }, who: { type: "string" } },
        (args) =>
          withOwner("restore", args.dir, async (owner) => {
            const entry = await owner.restore(
              pointOf(await owner.list(), args.ref),
              whoOf(args.who),
            );
            print(args.json, { entry }, entry ? `Restored: ${line(entry)}` : "Already there.");
          }),
      ),
    peek: () =>
      sub<{ ref: string; path?: string; dir?: string; json: boolean }>(
        "peek",
        "The files at an entry, a time, or 'start' (read-only); with a path, that file",
        {
          ref: { type: "positional", required: true },
          path: { type: "positional", required: false },
        },
        (args) =>
          withOwner("peek", args.dir, async (owner) => {
            const files = await owner.peek(pointOf(await owner.list(), args.ref));
            if (!files) throw new Refusal("That point is no longer kept");
            if (!args.path) return print(args.json, { files }, Object.keys(files).join("\n"));
            const hash = files[args.path];
            if (!hash) throw new Refusal(`${args.path} did not exist then`);
            process.stdout.write(await owner.blob(hash));
          }),
      ),
    pin: () =>
      sub<{ ref: string; off: boolean; dir?: string; json: boolean }>(
        "pin",
        "Keep an entry (and what it needs) when old history is trimmed",
        { ref: { type: "positional", required: true }, off: { type: "boolean", default: false } },
        (args) =>
          withOwner("pin", args.dir, async (owner) => {
            const entry = entryOf(await owner.list(), args.ref);
            await owner.pin(entry.id, !args.off);
            print(
              args.json,
              { id: entry.id, pinned: !args.off },
              `${args.off ? "Unpinned" : "Pinned"} ${short(entry.id)}`,
            );
          }),
      ),
    begin: () =>
      sub<{ who: string; label: string; dir?: string; json: boolean }>(
        "begin",
        "Start a turn: your writes until `end` become one entry under your name",
        { who: { type: "string", required: true }, label: { type: "string", required: true } },
        (args) =>
          withOwner("begin", args.dir, async (owner, turn, projectDir) => {
            if (turn) await owner.end(turn.id);
            const who: HistoryWho = { kind: "agent", name: args.who };
            const id = await owner.begin(who, args.label);
            writeTurn(projectDir, {
              via: owner.via,
              id,
              who,
              label: args.label,
              startedAt: Date.now(),
            });
            print(args.json, { entryId: id }, short(id));
          }),
      ),
    end: () =>
      sub<{ dir?: string; json: boolean }>("end", "End your turn and print its entry", {}, (args) =>
        withOwner("end", args.dir, async (owner, turn, projectDir) => {
          if (!turn) throw new Refusal("No turn is open; start one with history begin");
          const entry = await owner.end(turn.id);
          writeTurn(projectDir, null);
          print(args.json, { entry }, entry ? line(entry) : "Nothing changed in this turn.");
        }),
      ),
  },
  run: ({ args }) => guarded(listEntries)(args),
});
