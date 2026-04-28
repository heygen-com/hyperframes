import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

interface PersistentEditHistoryStoreOptions {
  projectId: string;
  storage: EditHistoryStorageAdapter;
  initialState: EditHistoryState;
  now?: () => number;
  onChange: (state: EditHistoryState) => void;
}

type EditHistoryMutation<T> = (state: EditHistoryState) => Promise<{
  state: EditHistoryState;
  result: T;
}>;

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

export function createPersistentEditHistoryStore({
  projectId,
  storage,
  initialState,
  now = Date.now,
  onChange,
}: PersistentEditHistoryStoreOptions) {
  let state = initialState;
  let queue = Promise.resolve();

  const save = async (nextState: EditHistoryState) => {
    state = nextState;
    onChange(nextState);
    try {
      await saveEditHistoryState(storage, projectId, nextState);
    } catch {
      // Keep in-memory history usable when IndexedDB is unavailable.
    }
  };

  const mutate = async <T>(mutation: EditHistoryMutation<T>): Promise<T> => {
    const run = queue.then(async () => {
      const { state: nextState, result } = await mutation(state);
      if (nextState !== state) await save(nextState);
      return result;
    });
    queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };

  return {
    snapshot: () => snapshotEditHistoryState(state),
    async recordEdit(input: RecordEditInput) {
      await mutate<void>(async (currentState) => {
        const timestamp = now();
        const entry = buildEditHistoryEntry({
          ...input,
          id: createEntryId(timestamp),
          projectId,
          now: timestamp,
        });
        return {
          state: pushEditHistoryEntry(currentState, entry),
          result: undefined,
        };
      });
    },
    async undo(callbacks: ApplyCallbacks): Promise<ApplyResult> {
      return mutate<ApplyResult>(async (currentState) => {
        const hashes = await callbacks.readCurrentHashes();
        const result = undoEditHistory(currentState, hashes, now());
        if (!result.ok) {
          return {
            state: currentState,
            result: { ok: false, reason: result.reason },
          };
        }
        await callbacks.writeFiles(result.filesToWrite);
        return {
          state: result.state,
          result: { ok: true, label: result.entry.label },
        };
      });
    },
    async redo(callbacks: ApplyCallbacks): Promise<ApplyResult> {
      return mutate<ApplyResult>(async (currentState) => {
        const hashes = await callbacks.readCurrentHashes();
        const result = redoEditHistory(currentState, hashes, now());
        if (!result.ok) {
          return {
            state: currentState,
            result: { ok: false, reason: result.reason },
          };
        }
        await callbacks.writeFiles(result.filesToWrite);
        return {
          state: result.state,
          result: { ok: true, label: result.entry.label },
        };
      });
    },
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
  const store = createPersistentEditHistoryStore({
    projectId,
    storage,
    initialState: state,
    now,
    onChange: (nextState) => {
      state = nextState;
      onChange(nextState);
    },
  });

  return store;
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
  const storeRef = useRef<ReturnType<typeof createPersistentEditHistoryStore> | null>(null);

  useEffect(() => {
    let cancelled = false;
    storeRef.current = null;
    setLoaded(false);
    if (!projectId) {
      setState(createEmptyEditHistory());
      setLoaded(true);
      return;
    }

    loadEditHistoryState(storage, projectId)
      .then((loadedState) => {
        if (cancelled) return;
        storeRef.current = createPersistentEditHistoryStore({
          projectId,
          storage,
          initialState: loadedState,
          now,
          onChange: setState,
        });
        setState(loadedState);
      })
      .catch(() => {
        if (cancelled) return;
        const emptyState = createEmptyEditHistory();
        storeRef.current = createPersistentEditHistoryStore({
          projectId,
          storage,
          initialState: emptyState,
          now,
          onChange: setState,
        });
        setState(emptyState);
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });

    return () => {
      cancelled = true;
    };
  }, [now, projectId, storage]);

  const recordEdit = useCallback(async (input: RecordEditInput) => {
    await storeRef.current?.recordEdit(input);
  }, []);

  const undo = useCallback(async (callbacks: ApplyCallbacks): Promise<ApplyResult> => {
    return storeRef.current?.undo(callbacks) ?? { ok: false, reason: "empty" };
  }, []);

  const redo = useCallback(async (callbacks: ApplyCallbacks): Promise<ApplyResult> => {
    return storeRef.current?.redo(callbacks) ?? { ok: false, reason: "empty" };
  }, []);

  return {
    loaded,
    ...snapshotEditHistoryState(state),
    recordEdit,
    undo,
    redo,
  };
}
