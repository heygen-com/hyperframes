import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  DEFAULT_HISTORY_ROOT,
  MAX_WINDOW_IDLE_MS,
  openProjectHistory,
  type HistoryEntry,
  type HistoryListItem,
  type HistoryResult,
  type HistoryWho,
} from "@hyperframes/studio-server";
import { resolveProject } from "./project.js";
import { findPreviewServerForProject, studioApiUrl } from "./studioSelectionClient.js";

export type UndoMode = "just-this" | "back-to-before";

/** An agent's turn: its writes until `end`, or until the idle limit passes without one, are one entry of its own. */
export interface Turn {
  via: "preview" | "direct";
  id: string;
  who: HistoryWho;
  label: string;
  startedAt: number;
  lastWriteAt: number;
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
  begin(who: HistoryWho, label: string): Promise<string>;
  end(id: string): Promise<HistoryEntry | null>;
  /** Runs `write` inside a window of its own: the entry it made, or null when it changed nothing. */
  record<T>(who: HistoryWho, label: string, write: () => T): Promise<Recorded<T>>;
  close(): Promise<void>;
}

interface Recorded<T> {
  result: T;
  entry: HistoryEntry | null;
}

async function writeIn<T>(
  close: () => Promise<HistoryEntry | null>,
  write: () => T,
): Promise<Recorded<T>> {
  let result: T;
  try {
    result = write();
  } catch (error) {
    // The write's own error is the one to report; a history that also fails to record it is logged.
    await close().catch((closeError: Error) =>
      console.error(`The history could not record this: ${closeError.message}`),
    );
    throw error;
  }
  return { result, entry: await close() };
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
    return typeof turn.lastWriteAt === "number" ? turn : null;
  } catch {
    return null;
  }
}

export function writeTurn(dir: string, turn: Turn | null): void {
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
      (await json("/window", { who, label, idleMs: historyDeps.turnIdleMs })).windowId,
    // A preview restarted since begin committed the window on its way down.
    end: (id) =>
      json(`/window/${id}/close`, {})
        .then((closed) => closed.entry as HistoryEntry | null)
        .catch(async () => (await list()).find((entry) => entry.id === id) ?? null),
    record: async (who, label, write) => {
      const { windowId } = await json("/window", { who, label });
      return writeIn(async () => (await json(`/window/${windowId}/close`, {})).entry, write);
    },
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
    begin: async () => randomUUID(),
    end: async (id) => history.list().find((entry) => entry.id === id) ?? null,
    record: async (who, label, write) => {
      const window = await history.beginWindow(who, label);
      return writeIn(() => window.close(), write);
    },
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
      writeTurn(projectDir, { ...turn, via: "direct", id: randomUUID(), lastWriteAt });
    }
  }
}

/**
 * Runs a write as one history entry, under the open turn's writer, else the person. When another process holds the
 * history (no preview to reach it through), writes anyway: that owner files the write as a change made outside.
 */
export async function recordInHistory<T>(
  dir: string,
  label: string,
  write: () => T,
): Promise<{ result: T; entryId: string | null }> {
  try {
    return await withOwner(dir, async (owner, turn) => {
      const who = turn?.who ?? { kind: "person" as const, name: "You" };
      const { result, entry } = await owner.record(who, label, write);
      return { result, entryId: entry?.id ?? null };
    });
  } catch (error) {
    if ((error as Error).name !== "HistoryBusyError") throw error;
    console.error(`${(error as Error).message} Wrote without an entry of its own.`);
    return { result: write(), entryId: null };
  }
}
