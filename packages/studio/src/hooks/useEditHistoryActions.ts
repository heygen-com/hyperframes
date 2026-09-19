// fallow-ignore-file complexity
import { useCallback, useMemo } from "react";
import { STUDIO_MOTION_PATH } from "../components/editor/studioMotion";
import { serializeStudioFileMutations } from "../utils/studioFileMutationCoordinator";

interface HistoryResult {
  ok: boolean;
  reason?: string;
  label?: string;
  paths?: string[];
  /** Per-file restored/previous content, used to soft-apply the preview. */
  files?: Record<string, { previous: string; restored: string }>;
}
interface HistoryFileCallbacks {
  readFile: (path: string) => Promise<string>;
  writeFile: (path: string, content: string) => Promise<void>;
  serialize?: <T>(paths: readonly string[], task: () => Promise<T>) => Promise<T>;
}
export interface EditHistoryHandle {
  undo: (cb: HistoryFileCallbacks) => Promise<HistoryResult>;
  redo: (cb: HistoryFileCallbacks) => Promise<HistoryResult>;
  state: {
    undo: ReadonlyArray<{ createdAt: number }>;
    redo: ReadonlyArray<{ createdAt: number }>;
  };
}

export interface UseEditHistoryActionsOptions {
  editHistory: Pick<EditHistoryHandle, "undo" | "redo">;
  readOptionalProjectFile: (path: string) => Promise<string>;
  readProjectFile: (path: string) => Promise<string>;
  writeProjectFile: (path: string, content: string) => Promise<void>;
  showToast: (message: string, tone?: "error" | "info") => void;
  syncHistoryPreviewAfterApply: (restore: {
    paths?: string[];
    files?: Record<string, { previous: string; restored: string }>;
  }) => Promise<void>;
  waitForPendingDomEditSaves: () => Promise<void>;
  onAfterUndoRedo?: () => void;
  /** Active composition path — decides whether undo/redo must resync the SDK session. */
  activeCompPath?: string | null;
  /** Reloads the SDK session after a revert of the active comp, past the self-write suppress window. */
  forceReloadSdkSession?: () => void;
}

/** Applies one persisted file-history step: the single owner of undo/redo over project files. */
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
  const writeHistoryFile = useCallback(
    async (path: string, content: string): Promise<void> => {
      await writeProjectFile(path, content);
    },
    [writeProjectFile],
  );
  const serializeHistoryFiles = useCallback(
    <T>(paths: readonly string[], task: () => Promise<T>) =>
      serializeStudioFileMutations(writeProjectFile, paths, task),
    [writeProjectFile],
  );

  const apply = useCallback(
    async (direction: "undo" | "redo") => {
      await waitForPendingDomEditSaves();
      const result = await editHistory[direction]({
        readFile: readHistoryFile,
        writeFile: writeHistoryFile,
        serialize: serializeHistoryFiles,
      });
      if (!result.ok && result.reason === "content-mismatch") {
        showToast(
          `File changed outside Studio. ${direction === "undo" ? "Undo" : "Redo"} history was not applied.`,
          "info",
        );
        return;
      }
      if (result.ok && result.label) {
        onAfterUndoRedo?.();
        if (activeCompPath && result.paths?.includes(activeCompPath)) {
          forceReloadSdkSession?.();
        }
        await syncHistoryPreviewAfterApply({ paths: result.paths, files: result.files });
        showToast(`${direction === "undo" ? "Undid" : "Redid"} ${result.label}`, "info");
      }
    },
    [
      editHistory,
      readHistoryFile,
      showToast,
      syncHistoryPreviewAfterApply,
      waitForPendingDomEditSaves,
      writeHistoryFile,
      serializeHistoryFiles,
      onAfterUndoRedo,
      activeCompPath,
      forceReloadSdkSession,
    ],
  );

  const undo = useCallback(() => apply("undo"), [apply]);
  const redo = useCallback(() => apply("redo"), [apply]);
  return useMemo(() => ({ undo, redo }), [undo, redo]);
}
