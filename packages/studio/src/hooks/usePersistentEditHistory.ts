import { useCallback, useEffect, useMemo, useState } from "react";
import {
  buildEditHistoryEntry,
  createEmptyEditHistory,
  pushEditHistoryEntry,
  redoEditHistory,
  undoEditHistory,
  type BuildEditHistoryEntryInput,
  type EditHistoryKind,
  type EditHistoryState,
} from "../utils/editHistory";
import {
  createIndexedDbEditHistoryStorage,
  loadEditHistoryState,
  saveEditHistoryState,
  type EditHistoryStorageAdapter,
} from "../utils/editHistoryStorage";

interface RecordEditInput {
  label: string;
  kind: EditHistoryKind;
  coalesceKey?: string;
  files: BuildEditHistoryEntryInput["files"];
}

interface ApplyCallbacks {
  readCurrentHashes: () => Promise<Record<string, string>>;
  writeFiles: (files: Record<string, string>) => Promise<void>;
}

interface UsePersistentEditHistoryOptions {
  projectId: string | null;
  storage?: EditHistoryStorageAdapter;
  now?: () => number;
}

interface ApplyResult {
  ok: boolean;
  reason?: "empty" | "content-mismatch";
  label?: string;
}

function createEntryId(now: number): string {
  return `edit-${now.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function snapshotEditHistoryState(state: EditHistoryState) {
  const undoEntry = state.undo[state.undo.length - 1] ?? null;
  const redoEntry = state.redo[state.redo.length - 1] ?? null;
  return {
    canUndo: Boolean(undoEntry),
    canRedo: Boolean(redoEntry),
    undoLabel: undoEntry?.label ?? null,
    redoLabel: redoEntry?.label ?? null,
    undoPaths: undoEntry ? Object.keys(undoEntry.files) : [],
    redoPaths: redoEntry ? Object.keys(redoEntry.files) : [],
    state,
  };
}

export async function createPersistentEditHistoryController({
  projectId,
  storage,
  now = Date.now,
  onChange,
}: {
  projectId: string;
  storage: EditHistoryStorageAdapter;
  now?: () => number;
  onChange: (state: EditHistoryState) => void;
}) {
  let state = await loadEditHistoryState(storage, projectId);

  const persist = async (nextState: EditHistoryState) => {
    state = nextState;
    onChange(nextState);
    try {
      await saveEditHistoryState(storage, projectId, nextState);
    } catch {
      // Keep in-memory history usable when IndexedDB is unavailable.
    }
  };

  return {
    snapshot: () => snapshotEditHistoryState(state),
    async recordEdit(input: RecordEditInput) {
      const timestamp = now();
      const entry = buildEditHistoryEntry({
        ...input,
        id: createEntryId(timestamp),
        projectId,
        now: timestamp,
      });
      const nextState = pushEditHistoryEntry(state, entry);
      if (nextState !== state) await persist(nextState);
    },
    async undo(callbacks: ApplyCallbacks): Promise<ApplyResult> {
      const hashes = await callbacks.readCurrentHashes();
      const result = undoEditHistory(state, hashes, now());
      if (!result.ok) return { ok: false, reason: result.reason };
      await callbacks.writeFiles(result.filesToWrite);
      await persist(result.state);
      return { ok: true, label: result.entry.label };
    },
    async redo(callbacks: ApplyCallbacks): Promise<ApplyResult> {
      const hashes = await callbacks.readCurrentHashes();
      const result = redoEditHistory(state, hashes, now());
      if (!result.ok) return { ok: false, reason: result.reason };
      await callbacks.writeFiles(result.filesToWrite);
      await persist(result.state);
      return { ok: true, label: result.entry.label };
    },
  };
}

export function usePersistentEditHistory(options: UsePersistentEditHistoryOptions) {
  const storage = useMemo(
    () => options.storage ?? createIndexedDbEditHistoryStorage(),
    [options.storage],
  );
  const now = options.now ?? Date.now;
  const [state, setState] = useState<EditHistoryState>(() => createEmptyEditHistory());
  const [loaded, setLoaded] = useState(false);
  const projectId = options.projectId;

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    if (!projectId) {
      setState(createEmptyEditHistory());
      setLoaded(true);
      return;
    }

    loadEditHistoryState(storage, projectId)
      .then((loadedState) => {
        if (cancelled) return;
        setState(loadedState);
      })
      .catch(() => {
        if (cancelled) return;
        setState(createEmptyEditHistory());
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });

    return () => {
      cancelled = true;
    };
  }, [projectId, storage]);

  const persist = useCallback(
    async (nextState: EditHistoryState) => {
      setState(nextState);
      if (projectId) {
        try {
          await saveEditHistoryState(storage, projectId, nextState);
        } catch {
          // Keep in-memory history usable when IndexedDB is unavailable.
        }
      }
    },
    [projectId, storage],
  );

  const recordEdit = useCallback(
    async (input: RecordEditInput) => {
      if (!projectId) return;
      const timestamp = now();
      const entry = buildEditHistoryEntry({
        ...input,
        id: createEntryId(timestamp),
        projectId,
        now: timestamp,
      });
      const nextState = pushEditHistoryEntry(state, entry);
      if (nextState !== state) {
        await persist(nextState);
      }
    },
    [now, persist, projectId, state],
  );

  const undo = useCallback(
    async (callbacks: ApplyCallbacks): Promise<ApplyResult> => {
      const hashes = await callbacks.readCurrentHashes();
      const result = undoEditHistory(state, hashes, now());
      if (!result.ok) return { ok: false, reason: result.reason };
      await callbacks.writeFiles(result.filesToWrite);
      await persist(result.state);
      return { ok: true, label: result.entry.label };
    },
    [now, persist, state],
  );

  const redo = useCallback(
    async (callbacks: ApplyCallbacks): Promise<ApplyResult> => {
      const hashes = await callbacks.readCurrentHashes();
      const result = redoEditHistory(state, hashes, now());
      if (!result.ok) return { ok: false, reason: result.reason };
      await callbacks.writeFiles(result.filesToWrite);
      await persist(result.state);
      return { ok: true, label: result.entry.label };
    },
    [now, persist, state],
  );

  return {
    loaded,
    ...snapshotEditHistoryState(state),
    recordEdit,
    undo,
    redo,
  };
}
