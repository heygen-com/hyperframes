import { useCallback, useRef } from "react";
import { saveProjectFilesWithHistory } from "../utils/studioFileHistory";
import type { EditHistoryKind } from "../utils/editHistory";
import { trackStudioEvent } from "../utils/studioTelemetry";
import {
  StudioFileConflictError,
  type StudioSaveDrainResult,
} from "../utils/studioSaveDiagnostics";

interface RecordEditInput {
  label: string;
  kind: EditHistoryKind;
  coalesceKey?: string;
  files: Record<string, { before: string; after: string }>;
}

interface UseEditorSaveOptions {
  editingPathRef: React.RefObject<string | undefined>;
  projectIdRef: React.RefObject<string | null>;
  readProjectFile: (path: string) => Promise<string>;
  writeProjectFile: (path: string, content: string, expectedContent?: string) => Promise<void>;
  recordEdit: (input: RecordEditInput) => Promise<void>;
  domEditSaveTimestampRef: React.MutableRefObject<number>;
  setRefreshKey: React.Dispatch<React.SetStateAction<number>>;
  showToast: (message: string, tone?: "error" | "info") => void;
}

export interface EditorSaveCandidate {
  projectId: string;
  path: string;
  content: string;
}

export type EditorSaveDrainResult = StudioSaveDrainResult;

export interface EditorSaveHandle {
  saveRafRef: React.MutableRefObject<number | null>;
  handleContentChange: (content: string) => void;
  /** Read by the external-reload reconciliation introduced in stack PR #2993. */
  getPendingCandidate: () => EditorSaveCandidate | null;
  /** Wired into the external-reload drain by stack PR #2993. */
  flushPendingSave: () => Promise<EditorSaveDrainResult>;
  /** Used by PR #2993 when the external version wins. */
  discardPendingSave: () => void;
}

export function useEditorSave({
  editingPathRef,
  projectIdRef,
  readProjectFile,
  writeProjectFile,
  recordEdit,
  domEditSaveTimestampRef,
  setRefreshKey,
  showToast,
}: UseEditorSaveOptions): EditorSaveHandle {
  const saveRafRef = useRef<number | null>(null);
  const refreshRafRef = useRef<number | null>(null);
  // One error toast per burst of failures — every keystroke retries the save,
  // and error toasts persist until dismissed, so don't stack duplicates.
  const lastFailureToastAtRef = useRef(0);
  const pendingCandidateRef = useRef<EditorSaveCandidate | null>(null);
  const inFlightRef = useRef<Promise<EditorSaveDrainResult> | null>(null);
  const inFlightCandidateRef = useRef<EditorSaveCandidate | null>(null);

  const reportFailure = useCallback(
    (path: string, error: unknown) => {
      trackStudioEvent("save_failure", {
        source: "code_editor",
        error_message: error instanceof Error ? error.message : "unknown",
      });
      const now = Date.now();
      if (now - lastFailureToastAtRef.current > 5000) {
        lastFailureToastAtRef.current = now;
        showToast(
          `Couldn't save ${path} — your latest edits are NOT persisted. Check the preview server; editing again retries the save.`,
          "error",
        );
      }
    },
    [showToast],
  );

  const persistCandidate = useCallback(
    (candidate: EditorSaveCandidate): Promise<EditorSaveDrainResult> => {
      const task = saveProjectFilesWithHistory({
        projectId: candidate.projectId,
        label: "Edit source",
        kind: "source",
        coalesceKey: `source:${candidate.path}`,
        files: { [candidate.path]: candidate.content },
        readFile: readProjectFile,
        writeFile: writeProjectFile,
        recordEdit,
      })
        .then<EditorSaveDrainResult>(() => {
          if (pendingCandidateRef.current === candidate) pendingCandidateRef.current = null;
          if (refreshRafRef.current != null) cancelAnimationFrame(refreshRafRef.current);
          refreshRafRef.current = requestAnimationFrame(() => setRefreshKey((k) => k + 1));
          return { status: "clean" };
        })
        .catch<EditorSaveDrainResult>((error: unknown) => {
          reportFailure(candidate.path, error);
          return error instanceof StudioFileConflictError
            ? { status: "conflict", error }
            : { status: "failed", error };
        })
        .finally(() => {
          if (inFlightRef.current === task) {
            inFlightRef.current = null;
            inFlightCandidateRef.current = null;
          }
        });
      inFlightRef.current = task;
      inFlightCandidateRef.current = candidate;
      return task;
    },
    [readProjectFile, recordEdit, reportFailure, setRefreshKey, writeProjectFile],
  );

  const handleContentChange = useCallback(
    (content: string) => {
      const pid = projectIdRef.current;
      if (!pid) return;
      const path = editingPathRef.current;
      if (!path) return;

      const candidate = { projectId: pid, path, content };
      pendingCandidateRef.current = candidate;

      if (saveRafRef.current != null) cancelAnimationFrame(saveRafRef.current);
      saveRafRef.current = requestAnimationFrame(() => {
        saveRafRef.current = null;
        domEditSaveTimestampRef.current = Date.now();
        void persistCandidate(candidate);
      });
    },
    [domEditSaveTimestampRef, editingPathRef, projectIdRef, persistCandidate],
  );

  const flushPendingSave = useCallback(async (): Promise<EditorSaveDrainResult> => {
    if (saveRafRef.current != null) {
      cancelAnimationFrame(saveRafRef.current);
      saveRafRef.current = null;
    }
    const candidate = pendingCandidateRef.current;
    if (candidate && candidate === inFlightCandidateRef.current && inFlightRef.current) {
      return inFlightRef.current;
    }
    if (candidate) {
      domEditSaveTimestampRef.current = Date.now();
      return persistCandidate(candidate);
    }
    return (await inFlightRef.current) ?? { status: "clean" };
  }, [domEditSaveTimestampRef, persistCandidate]);

  const discardPendingSave = useCallback(() => {
    if (saveRafRef.current != null) cancelAnimationFrame(saveRafRef.current);
    saveRafRef.current = null;
    pendingCandidateRef.current = null;
  }, []);

  return {
    saveRafRef,
    handleContentChange,
    getPendingCandidate: () => pendingCandidateRef.current,
    flushPendingSave,
    discardPendingSave,
  };
}
