// fallow-ignore-file complexity
import { useCallback, useMemo } from "react";
import { STUDIO_MOTION_PATH } from "../components/editor/studioMotion";
import { serializeStudioFileMutations } from "../utils/studioFileMutationCoordinator";
import type { ToastAction } from "../utils/studioHelpers";

interface HistoryResult {
  ok: boolean;
  reason?: string;
  message?: string;
  label?: string;
  paths?: string[];
  /** Per-file restored/previous content, used to soft-apply the preview. */
  files?: Record<string, { previous: string; restored: string }>;
  changedSince?: { id: string; label: string };
}
interface HistoryFileCallbacks {
  readFile: (path: string) => Promise<string>;
  serialize?: <T>(paths: readonly string[], task: () => Promise<T>) => Promise<T>;
}
export interface EditHistoryHandle {
  undo: (cb: HistoryFileCallbacks) => Promise<HistoryResult>;
  redo: (cb: HistoryFileCallbacks) => Promise<HistoryResult>;
  undoEntry?: (entryId: string, cb: HistoryFileCallbacks) => Promise<HistoryResult>;
  state: {
    undo: ReadonlyArray<{ createdAt: number }>;
    redo: ReadonlyArray<{ createdAt: number }>;
  };
}

export interface UseEditHistoryActionsOptions {
  editHistory: Pick<EditHistoryHandle, "undo" | "redo" | "undoEntry">;
  readOptionalProjectFile: (path: string) => Promise<string>;
  readProjectFile: (path: string) => Promise<string>;
  writeProjectFile: (path: string, content: string) => Promise<void>;
  showToast: (message: string, tone?: "error" | "info", action?: ToastAction) => void;
  syncHistoryPreviewAfterApply: (restore: Pick<HistoryResult, "paths" | "files">) => Promise<void>;
  waitForPendingDomEditSaves: () => Promise<void>;
  onAfterUndoRedo?: () => void;
  /** Active composition path — decides whether undo/redo must resync the SDK session. */
  activeCompPath?: string | null;
  /** Reloads the SDK session after a revert of the active comp, past the self-write suppress window. */
  forceReloadSdkSession?: () => void;
}

/** Takes one step of the project's history: the single owner of undo/redo over project files. */
export function useEditHistoryActions({
  editHistory,
  readOptionalProjectFile,
  readProjectFile,
  writeProjectFile,
  showToast,
  syncHistoryPreviewAfterApply,
  waitForPendingDomEditSaves,
  onAfterUndoRedo,
  activeCompPath,
  forceReloadSdkSession,
}: UseEditHistoryActionsOptions) {
  const readHistoryFile = useCallback(
    (path: string): Promise<string> =>
      path === STUDIO_MOTION_PATH ? readOptionalProjectFile(path) : readProjectFile(path),
    [readOptionalProjectFile, readProjectFile],
  );
  const serializeHistoryFiles = useCallback(
    <T>(paths: readonly string[], task: () => Promise<T>) =>
      serializeStudioFileMutations(writeProjectFile, paths, task),
    [writeProjectFile],
  );

  const apply = useCallback(
    async (
      direction: "undo" | "redo",
      take: (cb: HistoryFileCallbacks) => Promise<HistoryResult>,
    ): Promise<void> => {
      const noun = direction === "undo" ? "Undo" : "Redo";
      await waitForPendingDomEditSaves();
      const result = await take({ readFile: readHistoryFile, serialize: serializeHistoryFiles });
      if (!result.ok && result.reason === "content-mismatch") {
        const files = result.paths?.join(", ");
        const since = result.changedSince;
        const { undoEntry } = editHistory;
        if (since && undoEntry) {
          showToast(
            `Can't ${direction}: ${since.label} changed ${files} since that edit.`,
            "info",
            {
              label: `Undo ${since.label}`,
              run: () => void apply("undo", (cb) => undoEntry(since.id, cb)),
            },
          );
          return;
        }
        showToast(`Can't ${direction}: ${files} changed since that edit.`, "info");
        return;
      }
      if (!result.ok && result.reason === "failed") {
        showToast(`${noun} failed: ${result.message}`, "error");
        return;
      }
      if (result.ok && result.label) {
        onAfterUndoRedo?.();
        if (activeCompPath && result.paths?.includes(activeCompPath)) {
          forceReloadSdkSession?.();
        }
        await syncHistoryPreviewAfterApply({ paths: result.paths, files: result.files });
        showToast(result.label, "info");
      }
    },
    [
      editHistory,
      readHistoryFile,
      showToast,
      syncHistoryPreviewAfterApply,
      waitForPendingDomEditSaves,
      serializeHistoryFiles,
      onAfterUndoRedo,
      activeCompPath,
      forceReloadSdkSession,
    ],
  );

  const undo = useCallback(() => apply("undo", editHistory.undo), [apply, editHistory]);
  const redo = useCallback(() => apply("redo", editHistory.redo), [apply, editHistory]);
  return useMemo(() => ({ undo, redo }), [undo, redo]);
}
