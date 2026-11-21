import { randomUUID } from "node:crypto";
import { accessSync, constants } from "node:fs";
import { join, resolve } from "node:path";
import { terminalText } from "@hyperframes/core/terminal-text";
import {
  DEFAULT_HISTORY_ROOT,
  HistoryBusyError,
  MAX_WINDOW_IDLE_MS,
  openProjectHistory,
  readProjectHistory,
  type HistoryEntry,
  type HistoryListItem,
  type HistoryResult,
  type HistoryWho,
  type UndoMode,
  isHistoryId,
} from "@hyperframes/studio-server/history";

import { resolveProject } from "./project.js";
import { readRecord, recordChangedAt, removeRecord, writeRecord } from "./projectRecords.js";
import { findPreviewServerForProject, studioApiUrl } from "./studioSelectionClient.js";

export type { UndoMode };

/** An agent's turn: its writes until `end`, or until the idle limit passes without one, are one entry of its own. */
export interface Turn {
  via: "preview" | "direct";
  id: string;
  who: HistoryWho;
  label: string;
  startedAt: number;
  lastWriteAt: number;
  writtenAt?: number;
  /** Entries this turn already filed: without a preview, each command mid-turn files the turn so far. */
  parts: string[];
}

/** Whoever holds the project's history: a running preview (over its routes) or this process (the engine). */
export interface Owner {
  via: "preview" | "direct";
  list(): Promise<HistoryListItem[]>;
  peek(point: string): Promise<Record<string, string> | null>;
  blob(hash: string): Promise<Buffer>;
  undo(id: string, who: HistoryWho, mode?: UndoMode): Promise<HistoryResult>;
  restore(point: string, who: HistoryWho): Promise<HistoryEntry | null>;
  pin(id: string, pinned: boolean): Promise<void>;
  begin(
    who: HistoryWho,
    label: string,
    exclusive?: boolean,
  ): Promise<{ id: string; startedAt: number }>;
  end(id: string): Promise<HistoryEntry | null>;
  checkpoint(): Promise<void>;
  close(): Promise<void>;
}

export type Reader = Pick<Owner, "via" | "list" | "peek" | "blob">;

/** Swapped by tests. */
export const historyDeps = {
  historyRoot: resolve(process.env.HYPERFRAMES_HISTORY_ROOT || DEFAULT_HISTORY_ROOT),
  findServer: async (projectDir: string) =>
    process.env.HYPERFRAMES_NO_PREVIEW_DISCOVERY === "1"
      ? null
      : findPreviewServerForProject(projectDir),
  /** A turn with no write for this long has ended, through a preview or not. */
  turnIdleMs: MAX_WINDOW_IDLE_MS,
  ownerWaitMs: undefined as number | undefined,
  now: () => Date.now(),
};

/** A refusal is the caller's to fix: commands print its message, never a stack. */
export class Refusal extends Error {}

const TURN_FILE = "history-turn.json";
const LAST_TURNS_FILE = "history-turns.json";
const MAX_RECORD_BYTES = 1024 * 1024;

const WHO_KINDS: readonly unknown[] = ["person", "agent", "outside"] satisfies HistoryWho["kind"][];
const isId = (value: unknown): value is string => typeof value === "string" && isHistoryId(value);
const isIds = (value: unknown): value is string[] => Array.isArray(value) && value.every(isId);
const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object";
const isVia = (value: unknown): value is Turn["via"] => value === "preview" || value === "direct";

function whoOf(value: unknown): HistoryWho | null {
  if (!isRecord(value) || !WHO_KINDS.includes(value.kind) || typeof value.name !== "string")
    return null;
  return { kind: value.kind as HistoryWho["kind"], name: value.name };
}

const isTurnHead = (value: Record<string, unknown>) => isVia(value.via) && isId(value.id);
const hasTurnFields = (value: Record<string, unknown>) =>
  typeof value.label === "string" &&
  typeof value.startedAt === "number" &&
  typeof value.lastWriteAt === "number";

function parseTurn(value: unknown): Turn | null {
  if (!isRecord(value) || !isTurnHead(value) || !hasTurnFields(value)) return null;
  const who = whoOf(value.who);
  const parts = value.parts ?? [];
  if (!who || !isIds(parts)) return null;
  const { via, id, label, startedAt, lastWriteAt } = value as Omit<Turn, "who" | "parts">;
  const writtenAt = typeof value.writtenAt === "number" ? value.writtenAt : undefined;
  return { via, id, who, label, startedAt, lastWriteAt, writtenAt, parts };
}

function lastWriteFileTime(dir: string, turn: Turn): number | undefined {
  const markedAt = recordChangedAt(dir, TURN_FILE);
  if (turn.writtenAt === undefined || !markedAt) return undefined;
  return markedAt - (turn.writtenAt - turn.lastWriteAt);
}

/** The open turn, or null; a marker with no last write time cannot say when the turn ended, so it has. */
function readTurn(dir: string): Turn | null {
  try {
    return parseTurn(JSON.parse(readRecord(dir, TURN_FILE, MAX_RECORD_BYTES)));
  } catch {
    return null;
  }
}

function writeRecordOrRefuse(dir: string, name: string, data: string): void {
  if (!writeRecord(dir, name, data))
    throw new Refusal(`Could not write ${join(dir, ".hyperframes", name)}.`);
}

export function writeTurn(dir: string, turn: Turn | null): void {
  if (!turn) return void removeRecord(dir, TURN_FILE);
  writeRecordOrRefuse(dir, TURN_FILE, JSON.stringify({ ...turn, writtenAt: historyDeps.now() }));
}

/** Each agent's last ended turn, as the entries it filed; kept beside the marker, outside the history. */
function readLastTurns(dir: string): Record<string, string[]> {
  try {
    const turns: unknown = JSON.parse(readRecord(dir, LAST_TURNS_FILE, MAX_RECORD_BYTES));
    if (!turns || typeof turns !== "object") return {};
    return Object.fromEntries(Object.entries(turns).filter(([, parts]) => isIds(parts)));
  } catch {
    return {};
  }
}

/** The entries of `name`'s last ended turn; null when `name` never ended a turn here. */
export function lastTurnParts(dir: string, name: string): string[] | null {
  return readLastTurns(dir)[name] ?? null;
}

type TurnKey = Pick<HistoryEntry, "who" | "label" | "startedAt">;
const samePart = (a: TurnKey, b: TurnKey) =>
  a.who.kind === b.who.kind &&
  a.who.name === b.who.name &&
  a.label === b.label &&
  a.startedAt === b.startedAt;

/** Ends an open turn: its last part is the entry `end` returns, and every part is kept as its agent's last turn. */
export async function endTurn(
  owner: Owner,
  turn: Turn,
  dir: string,
): Promise<{ entry: HistoryEntry | null; parts: string[] }> {
  const entry = await owner.end(turn.id);
  // A Studio claim can cut a turn: each cut part is an entry with the turn's who, label and start.
  const cut = (await owner.list()).filter((other) => samePart(other, entry ?? turn));
  const own = entry ? [entry.id] : [];
  const parts = [...new Set([...turn.parts, ...cut.map((part) => part.id), ...own])];
  // Recorded before the marker goes, so a crash between the two never leaves the older turn as the last one.
  writeRecordOrRefuse(
    dir,
    LAST_TURNS_FILE,
    JSON.stringify({ ...readLastTurns(dir), [turn.who.name]: parts }),
  );
  writeTurn(dir, null);
  return { entry, parts };
}

function previewOwner(route: (path: string) => string): Owner {
  const call = async (path: string, body?: object, signal?: AbortSignal) => {
    const init = {
      ...(body && {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      ...(signal && { signal }),
    };
    const response = await fetch(route(path), init);
    if (response.ok) return response;
    const error = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Refusal(error?.error ?? `The preview answered ${response.status}.`);
  };
  const json = async (path: string, body?: object, signal?: AbortSignal) =>
    (await call(path, body, signal)).json();
  const list = async () => (await json("")).entries as HistoryListItem[];
  return {
    via: "preview",
    list,
    peek: async (point) => (await json(`/peek/${encodeURIComponent(point)}`)).files,
    blob: async (hash) =>
      Buffer.from(await (await call(`/blob/${encodeURIComponent(hash)}`)).arrayBuffer()),
    undo: (id, who, mode) => json("/undo", { entryId: id, who, mode }),
    restore: (point, who) => json("/restore", { point, who }),
    pin: async (id, pinned) => void (await json("/pin", { entryId: id, pinned })),
    begin: async (who, label, exclusive) => {
      const opened = await json("/window", {
        who,
        label,
        idleMs: historyDeps.turnIdleMs,
        ...(exclusive && { exclusive: true }),
      });
      return { id: opened.windowId, startedAt: opened.startedAt ?? historyDeps.now() };
    },
    // A preview restarted since begin committed the window on its way down.
    end: (id) =>
      json(`/window/${encodeURIComponent(id)}/close`, {})
        .then((closed) => closed.entry as HistoryEntry | null)
        .catch(async () => (await list()).find((entry) => entry.id === id) ?? null),
    checkpoint: async () => void (await json("/checkpoint", {}, AbortSignal.timeout(5_000))),
    close: async () => {},
  };
}

async function relistWrites(projectDir: string, entry: HistoryEntry | null): Promise<void> {
  if (!entry?.files.length) return;
  const { relistHistoryWrites } = await import("./receivedRecordFollow.js");
  await relistHistoryWrites(projectDir, entry).catch((error: unknown) =>
    console.warn(`Could not update the received-files record: ${terminalText(String(error))}`),
  );
}

async function directOwner(
  projectDir: string,
  ownerWaitMs = historyDeps.ownerWaitMs,
): Promise<{ owner: Owner; turn: Turn | null }> {
  let turn: Turn | null = null;
  const history = await openProjectHistory({
    projectDir,
    historyRoot: historyDeps.historyRoot,
    now: () => historyDeps.now(),
    pruneGoneProjectsBudgetMs: 1000,
    ownerWaitMs,
    closedWindowAfterOwnership: () => {
      turn = readTurn(projectDir);
      return turn
        ? {
            id: turn.id,
            who: turn.who,
            label: turn.label,
            startedAt: turn.startedAt,
            lastWriteAt: turn.lastWriteAt,
            lastWriteFileTime: lastWriteFileTime(projectDir, turn),
            idleMs: historyDeps.turnIdleMs,
          }
        : undefined;
    },
  });
  return {
    turn,
    owner: {
      via: "direct",
      list: async () => history.list(),
      peek: async (point) => history.peek(point),
      blob: (hash) => history.readBlob(hash),
      undo: async (id, who, mode) => {
        const undone = await history.undo(id, { who, ...(mode && { mode }) });
        if (undone.ok) await relistWrites(projectDir, undone.entry);
        return undone;
      },
      restore: async (point, who) => {
        const restored = await history.restore(point, who);
        await relistWrites(projectDir, restored);
        return restored;
      },
      pin: async (id, pinned) => history.pin(id, pinned),
      // Opening filed every earlier write; the turn's own writes are filed to it when the next open passes it.
      begin: async () => ({ id: randomUUID(), startedAt: historyDeps.now() }),
      end: async (id) => history.list().find((entry) => entry.id === id) ?? null,
      checkpoint: () => history.checkpoint(),
      close: () => history.close(),
    },
  };
}

/** One owner: a preview that keeps this project's history, else the engine, which refuses a second opener. */
async function connect(
  projectDir: string,
  ownerWaitMs?: number,
): Promise<{ owner: Owner; turn: Turn | null }> {
  const server = await historyDeps.findServer(projectDir);
  if (server) {
    const route = (path: string) => studioApiUrl(server, `history${path}`);
    // 404, or gone since the scan: no preview keeps this history, and the engine's lock guards the rest.
    const status = await fetch(route("")).then(
      (response) => response.status,
      () => 404,
    );
    if (status !== 404) return { owner: previewOwner(route), turn: readTurn(projectDir) };
  }
  return directOwner(projectDir, ownerWaitMs);
}

/** Runs `task` with the project's history. ponytail: with no preview, a command mid-turn splits the turn in two. */
export async function withOwner<T>(
  dir: string | undefined,
  task: (owner: Owner, turn: Turn | null, projectDir: string) => Promise<T>,
  { ownerWaitMs }: { ownerWaitMs?: number } = {},
): Promise<T> {
  const { dir: projectDir } = resolveProject(dir);
  const { owner, turn } = await connect(projectDir, ownerWaitMs);
  try {
    return await task(owner, turn, projectDir);
  } finally {
    // This open filed the turn so far under its id; the turn goes on under a fresh one, from its last write.
    try {
      if (owner.via === "direct" && turn) {
        const kept = (await owner.list()).find((entry) => entry.id === turn.id);
        if (readTurn(projectDir)?.id === turn.id) {
          const lastWriteAt = kept ? kept.endedAt : turn.lastWriteAt;
          const parts = kept ? [...turn.parts, kept.id] : turn.parts;
          writeTurn(projectDir, { ...turn, via: "direct", id: randomUUID(), lastWriteAt, parts });
        }
      }
    } finally {
      await owner.close();
    }
  }
}

const CANNOT_WRITE = new Set(["ENOSPC", "EDQUOT", "EACCES", "EPERM", "EROFS"]);
const WRITE_CALLS = new Set([
  "mkdir",
  "write",
  "rename",
  "unlink",
  "link",
  "copyfile",
  "rmdir",
  "symlink",
  "utime",
  "ftruncate",
  "fsync",
]);

function openedForWriting(path: string): boolean {
  try {
    accessSync(path, constants.R_OK);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT";
  }
}

/** A write the history could not make, never a read: a denied `open` of a missing or readable file was a write. */
function failedWrite(error: unknown): boolean {
  const { code = "", syscall = "", path } = error as NodeJS.ErrnoException;
  if (!CANNOT_WRITE.has(code)) return false;
  return (
    WRITE_CALLS.has(syscall) || (syscall === "open" && path !== undefined && openedForWriting(path))
  );
}

export async function withReader<T>(
  dir: string | undefined,
  task: (reader: Reader) => Promise<T>,
): Promise<T> {
  let ran = false;
  try {
    return await withOwner(dir, (owner) => {
      ran = true;
      return task(owner);
    });
  } catch (error) {
    const unwritable = failedWrite(error);
    if (ran || !(error instanceof HistoryBusyError || unwritable)) throw error;
    if (unwritable)
      console.error(
        `[hyperframes] Could not write this project's history (${terminalText((error as Error).message)}); showing it as last recorded.`,
      );
  }
  // Opening failed, so the task has not run; an open turn's marker is left as it is.
  const view = readProjectHistory({
    projectDir: resolveProject(dir).dir,
    historyRoot: historyDeps.historyRoot,
  });
  return task({
    via: "direct",
    list: async () => view.list(),
    peek: async (point) => view.peek(point),
    // The owner may have pruned a blob since its log was read.
    blob: (hash) =>
      view.readBlob(hash).catch((error: NodeJS.ErrnoException) => {
        throw error.code === "ENOENT" ? new Refusal("That point is no longer kept") : error;
      }),
  });
}
