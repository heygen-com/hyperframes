import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  DEFAULT_HISTORY_ROOT,
  MAX_WINDOW_IDLE_MS,
  openProjectHistory,
  type HistoryEntry,
  type HistoryListItem,
  type HistoryResult,
  type HistoryWho,
  type UndoMode,
} from "@hyperframes/studio-server";

import { resolveProject } from "./project.js";
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
  begin(who: HistoryWho, label: string): Promise<{ id: string; startedAt: number }>;
  end(id: string): Promise<HistoryEntry | null>;
  close(): Promise<void>;
}

/** Swapped by tests. */
export const historyDeps = {
  historyRoot: DEFAULT_HISTORY_ROOT,
  findServer: (projectDir: string) => findPreviewServerForProject(projectDir),
  /** A turn with no write for this long has ended, through a preview or not. */
  turnIdleMs: MAX_WINDOW_IDLE_MS,
};

/** A refusal is the caller's to fix: commands print its message, never a stack. */
export class Refusal extends Error {}

const turnFile = (dir: string) => join(dir, ".hyperframes", "history-turn.json");

/** The open turn, or null; a marker with no last write time cannot say when the turn ended, so it has. */
function readTurn(dir: string): Turn | null {
  try {
    const turn = JSON.parse(readFileSync(turnFile(dir), "utf-8")) as Turn;
    return typeof turn.lastWriteAt === "number" ? { ...turn, parts: turn.parts ?? [] } : null;
  } catch {
    return null;
  }
}

export function writeTurn(dir: string, turn: Turn | null): void {
  if (!turn) return rmSync(turnFile(dir), { force: true });
  mkdirSync(dirname(turnFile(dir)), { recursive: true });
  writeFileSync(turnFile(dir), JSON.stringify(turn));
}

/** Each agent's last ended turn, as the entries it filed; kept beside the marker, outside the history. */
const lastTurnsFile = (dir: string) => join(dir, ".hyperframes", "history-turns.json");

function readLastTurns(dir: string): Record<string, string[]> {
  try {
    const turns: unknown = JSON.parse(readFileSync(lastTurnsFile(dir), "utf-8"));
    return turns && typeof turns === "object" ? (turns as Record<string, string[]>) : {};
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
  const draft = `${lastTurnsFile(dir)}.${process.pid}.tmp`;
  mkdirSync(dirname(draft), { recursive: true });
  writeFileSync(draft, JSON.stringify({ ...readLastTurns(dir), [turn.who.name]: parts }));
  renameSync(draft, lastTurnsFile(dir));
  writeTurn(dir, null);
  return { entry, parts };
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
    begin: async (who, label) => {
      const opened = await json("/window", { who, label, idleMs: historyDeps.turnIdleMs });
      return { id: opened.windowId, startedAt: opened.startedAt ?? Date.now() };
    },
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
    // A turn begun through a preview that has since stopped is still the agent's, until its idle limit.
    ...(turn && {
      closedWindow: {
        id: turn.id,
        who: turn.who,
        label: turn.label,
        startedAt: turn.startedAt,
        lastWriteAt: turn.lastWriteAt,
        idleMs: historyDeps.turnIdleMs,
      },
    }),
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
    begin: async () => ({ id: randomUUID(), startedAt: Date.now() }),
    end: async (id) => history.list().find((entry) => entry.id === id) ?? null,
    close: () => history.close(),
  };
}

/** One owner: a preview that keeps this project's history, else the engine, which refuses a second opener. */
async function connect(projectDir: string, turn: Turn | null): Promise<Owner> {
  const server = await historyDeps.findServer(projectDir);
  if (server) {
    const route = (path: string) => studioApiUrl(server, `history${path}`);
    // 404, or gone since the scan: no preview keeps this history, and the engine's lock guards the rest.
    const status = await fetch(route("")).then(
      (response) => response.status,
      () => 404,
    );
    if (status !== 404) return previewOwner(route);
  }
  return directOwner(projectDir, turn);
}

/** Runs `task` with the project's history. ponytail: with no preview, a command mid-turn splits the turn in two. */
export async function withOwner<T>(
  dir: string | undefined,
  task: (owner: Owner, turn: Turn | null, projectDir: string) => Promise<T>,
): Promise<T> {
  const { dir: projectDir } = resolveProject(dir);
  const turn = readTurn(projectDir);
  const owner = await connect(projectDir, turn);
  try {
    return await task(owner, turn, projectDir);
  } finally {
    // This open filed the turn so far under its id; the turn goes on under a fresh one, from its last write.
    const direct = owner.via === "direct" && turn;
    const kept = direct && (await owner.list()).find((entry) => entry.id === turn.id);
    await owner.close();
    if (direct && readTurn(projectDir)?.id === turn.id) {
      const lastWriteAt = kept ? kept.endedAt : turn.lastWriteAt;
      const parts = kept ? [...turn.parts, kept.id] : turn.parts;
      writeTurn(projectDir, { ...turn, via: "direct", id: randomUUID(), lastWriteAt, parts });
    }
  }
}
