export type EditHistoryKind = "manual" | "timeline" | "source";

export interface EditHistoryFileSnapshot {
  before: string;
  after: string;
  beforeHash: string;
  afterHash: string;
}

export interface EditHistoryEntry {
  id: string;
  projectId: string;
  label: string;
  kind: EditHistoryKind;
  coalesceKey?: string;
  createdAt: number;
  files: Record<string, EditHistoryFileSnapshot>;
}

export interface EditHistoryState {
  version: 1;
  updatedAt: number;
  undo: EditHistoryEntry[];
  redo: EditHistoryEntry[];
}

export interface EditHistoryOptions {
  maxEntries?: number;
  coalesceMs?: number;
}

export interface BuildEditHistoryEntryInput {
  id: string;
  projectId: string;
  label: string;
  kind?: EditHistoryKind;
  coalesceKey?: string;
  now: number;
  files: Record<string, { before: string; after: string }>;
}

export type EditHistoryDirection = "undo" | "redo";

export type EditHistoryApplyCheck =
  | { ok: true }
  | { ok: false; reason: "content-mismatch"; path: string };

export type EditHistoryTransitionResult =
  | {
      ok: true;
      state: EditHistoryState;
      entry: EditHistoryEntry;
      filesToWrite: Record<string, string>;
    }
  | {
      ok: false;
      reason: "empty" | "content-mismatch";
      state: EditHistoryState;
      filesToWrite: Record<string, string>;
      path?: string;
    };

const DEFAULT_MAX_ENTRIES = 100;
const DEFAULT_COALESCE_MS = 1500;

export function hashEditHistoryContent(content: string): string {
  let hash = 2166136261;
  for (let index = 0; index < content.length; index += 1) {
    hash ^= content.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function createEmptyEditHistory(_options?: EditHistoryOptions): EditHistoryState {
  return {
    version: 1,
    updatedAt: 0,
    undo: [],
    redo: [],
  };
}

export function buildEditHistoryEntry(input: BuildEditHistoryEntryInput): EditHistoryEntry {
  const files: Record<string, EditHistoryFileSnapshot> = {};
  for (const [path, snapshot] of Object.entries(input.files)) {
    if (snapshot.before === snapshot.after) continue;
    files[path] = {
      before: snapshot.before,
      after: snapshot.after,
      beforeHash: hashEditHistoryContent(snapshot.before),
      afterHash: hashEditHistoryContent(snapshot.after),
    };
  }

  return {
    id: input.id,
    projectId: input.projectId,
    label: input.label,
    kind: input.kind ?? "manual",
    coalesceKey: input.coalesceKey,
    createdAt: input.now,
    files,
  };
}

export function pushEditHistoryEntry(
  state: EditHistoryState,
  entry: EditHistoryEntry,
  options?: EditHistoryOptions,
): EditHistoryState {
  if (Object.keys(entry.files).length === 0) return state;

  const coalesceMs = options?.coalesceMs ?? DEFAULT_COALESCE_MS;
  const maxEntries = options?.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const previous = state.undo[state.undo.length - 1];
  let undo = state.undo;

  if (
    previous &&
    previous.coalesceKey &&
    previous.coalesceKey === entry.coalesceKey &&
    entry.createdAt - previous.createdAt <= coalesceMs
  ) {
    const files: Record<string, EditHistoryFileSnapshot> = {};
    for (const [path, snapshot] of Object.entries(entry.files)) {
      const previousSnapshot = previous.files[path];
      files[path] = previousSnapshot
        ? {
            before: previousSnapshot.before,
            after: snapshot.after,
            beforeHash: previousSnapshot.beforeHash,
            afterHash: snapshot.afterHash,
          }
        : snapshot;
    }
    undo = [...state.undo.slice(0, -1), { ...entry, files }];
  } else {
    undo = [...state.undo, entry];
  }

  return {
    version: 1,
    updatedAt: entry.createdAt,
    undo: undo.slice(Math.max(0, undo.length - maxEntries)),
    redo: [],
  };
}

export function canApplyEditHistoryEntry(
  entry: EditHistoryEntry,
  direction: EditHistoryDirection,
  currentHashes: Record<string, string>,
): EditHistoryApplyCheck {
  for (const [path, snapshot] of Object.entries(entry.files)) {
    const expected = direction === "undo" ? snapshot.afterHash : snapshot.beforeHash;
    if (currentHashes[path] !== expected) {
      return { ok: false, reason: "content-mismatch", path };
    }
  }
  return { ok: true };
}

export function undoEditHistory(
  state: EditHistoryState,
  currentHashes: Record<string, string>,
  now: number,
): EditHistoryTransitionResult {
  const entry = state.undo[state.undo.length - 1];
  if (!entry) return { ok: false, reason: "empty", state, filesToWrite: {} };

  const check = canApplyEditHistoryEntry(entry, "undo", currentHashes);
  if (!check.ok) {
    return { ok: false, reason: check.reason, path: check.path, state, filesToWrite: {} };
  }

  return {
    ok: true,
    entry,
    filesToWrite: Object.fromEntries(
      Object.entries(entry.files).map(([path, snapshot]) => [path, snapshot.before]),
    ),
    state: {
      version: 1,
      updatedAt: now,
      undo: state.undo.slice(0, -1),
      redo: [...state.redo, entry],
    },
  };
}

export function redoEditHistory(
  state: EditHistoryState,
  currentHashes: Record<string, string>,
  now: number,
): EditHistoryTransitionResult {
  const entry = state.redo[state.redo.length - 1];
  if (!entry) return { ok: false, reason: "empty", state, filesToWrite: {} };

  const check = canApplyEditHistoryEntry(entry, "redo", currentHashes);
  if (!check.ok) {
    return { ok: false, reason: check.reason, path: check.path, state, filesToWrite: {} };
  }

  return {
    ok: true,
    entry,
    filesToWrite: Object.fromEntries(
      Object.entries(entry.files).map(([path, snapshot]) => [path, snapshot.after]),
    ),
    state: {
      version: 1,
      updatedAt: now,
      undo: [...state.undo, entry],
      redo: state.redo.slice(0, -1),
    },
  };
}
