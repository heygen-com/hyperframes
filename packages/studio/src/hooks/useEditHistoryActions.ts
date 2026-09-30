// fallow-ignore-file complexity
import { useCallback, useMemo } from "react";
import { STUDIO_MOTION_PATH } from "../components/editor/studioMotion";
import { serializeStudioFileMutations } from "../utils/studioFileMutationCoordinator";

interface HistoryResult {
  ok: boolean;
  reason?: string;
  message?: string;
  label?: string;
  paths?: string[];
  /** Per-file restored/previous content, used to soft-apply the preview. */
  files?: Record<string, { previous: string; restored: string }>;
}
type RestoreFiles = Record<string, { previous: string; restored: string }>;
interface HistoryFileCallbacks {
  readFile: (path: string) => Promise<string>;
  serialize?: <T>(paths: readonly string[], task: () => Promise<T>) => Promise<T>;
}
export interface EditHistoryHandle {
  undo: (cb: HistoryFileCallbacks) => Promise<HistoryResult>;
  redo: (cb: HistoryFileCallbacks) => Promise<HistoryResult>;
  /** The restore a step would make, when this tab already knows it. */
  predict?: (direction: "undo" | "redo") => RestoreFiles | null;
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
  /** Shows a restore on the live preview in this task, or returns false having touched nothing (e.g. a save is pending). */
  showHistoryRestoreNow?: (files: RestoreFiles) => boolean;
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
      const shown = predicted && showHistoryRestoreNow?.(predicted) ? predicted : null;
      let result: HistoryResult = { ok: false, reason: "failed" };
      try {
        await waitForPendingDomEditSaves();
        result = await editHistory[direction]({
          readFile: readHistoryFile,
          serialize: serializeHistoryFiles,
        });
      } finally {
        if (shown && !(result.ok && result.label)) {
          void syncHistoryPreviewAfterApply({
            paths: Object.keys(shown),
            files: swapRestore(shown),
          });
        }
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
        const restore = { paths: result.paths, files: fromShown(result.files, shown) };
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

function swapRestore(files: RestoreFiles): RestoreFiles {
  return Object.fromEntries(
    Object.entries(files).map(([path, f]) => [
      path,
      { previous: f.restored, restored: f.previous },
    ]),
  );
}

/** The server's restore, diffed from what the preview already shows. */
function fromShown(files: RestoreFiles | undefined, shown: RestoreFiles | null) {
  if (!files || !shown) return files;
  return Object.fromEntries(
    Object.entries(files).map(([path, f]) => [
      path,
      { previous: shown[path]?.restored ?? f.previous, restored: f.restored },
    ]),
  );
}
