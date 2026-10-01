// fallow-ignore-file complexity
import { useCallback, useMemo } from "react";
import { STUDIO_MOTION_PATH } from "../components/editor/studioMotion";
import { serializeStudioFileMutations } from "../utils/studioFileMutationCoordinator";
import type { RestoreFiles } from "../utils/gsapUndoRestore";

interface HistoryResult {
  ok: boolean;
  reason?: string;
  message?: string;
  label?: string;
  paths?: string[];
  undoes?: string;
  /** Per-file restored/previous content, used to soft-apply the preview. */
  files?: RestoreFiles;
}
interface HistoryFileCallbacks {
  readFile: (path: string) => Promise<string>;
  serialize?: <T>(paths: readonly string[], task: () => Promise<T>) => Promise<T>;
}
export interface EditHistoryHandle {
  undo: (cb: HistoryFileCallbacks) => Promise<HistoryResult>;
  redo: (cb: HistoryFileCallbacks) => Promise<HistoryResult>;
  predict?: (direction: "undo" | "redo") => { id: string; files: RestoreFiles } | null;
  state: {
    undo: ReadonlyArray<{ createdAt: number }>;
    redo: ReadonlyArray<{ createdAt: number }>;
  };
}

export interface UseEditHistoryActionsOptions {
  editHistory: Pick<EditHistoryHandle, "undo" | "redo" | "predict">;
  readOptionalProjectFile: (path: string) => Promise<string>;
  readProjectFile: (path: string) => Promise<string>;
  writeProjectFile: (path: string, content: string) => Promise<void>;
  showToast: (message: string, tone?: "error" | "info") => void;
  syncHistoryPreviewAfterApply: (restore: Pick<HistoryResult, "paths" | "files">) => Promise<void>;
  showHistoryRestoreNow?: (files: RestoreFiles) => (() => void) | null;
  waitForPendingDomEditSaves: () => Promise<void>;
  onAfterUndoRedo?: (restore: Pick<HistoryResult, "paths" | "files">) => void;
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
  showHistoryRestoreNow,
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
    async (direction: "undo" | "redo") => {
      const noun = direction === "undo" ? "Undo" : "Redo";
      // Paint the step in the key's own task when this tab knows it; the server's answer then confirms or corrects.
      const predicted = editHistory.predict?.(direction) ?? null;
      const putBack = predicted ? (showHistoryRestoreNow?.(predicted.files) ?? null) : null;
      let result: HistoryResult = { ok: false, reason: "failed" };
      let serverSteppedShown = false;
      try {
        await waitForPendingDomEditSaves();
        result = await editHistory[direction]({
          readFile: readHistoryFile,
          serialize: serializeHistoryFiles,
        });
        serverSteppedShown =
          Boolean(putBack && result.ok && result.label) && result.undoes === predicted?.id;
      } finally {
        if (putBack && !serverSteppedShown) putBack();
      }
      if (!result.ok && result.reason === "content-mismatch") {
        showToast(
          `Can't ${direction}: ${result.paths?.join(", ")} changed since that edit.`,
          "info",
        );
        return;
      }
      if (!result.ok && result.reason === "failed") {
        showToast(`${noun} failed: ${result.message}`, "error");
        return;
      }
      if (result.ok && result.label) {
        const files = serverSteppedShown ? fromShown(result.files, predicted!.files) : result.files;
        const restore = { paths: result.paths, files };
        onAfterUndoRedo?.(restore);
        if (activeCompPath && result.paths?.includes(activeCompPath)) {
          forceReloadSdkSession?.();
        }
        await syncHistoryPreviewAfterApply(restore);
        showToast(result.label, "info");
      }
    },
    [
      editHistory,
      readHistoryFile,
      showToast,
      syncHistoryPreviewAfterApply,
      showHistoryRestoreNow,
      waitForPendingDomEditSaves,
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

function fromShown(files: RestoreFiles | undefined, shown: RestoreFiles) {
  if (!files) return files;
  return Object.fromEntries(
    Object.entries(files).map(([path, f]) => [
      path,
      { previous: shown[path]?.restored ?? f.previous, restored: f.restored },
    ]),
  );
}
