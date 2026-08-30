import { useCallback } from "react";
import type { DomEditSelection } from "../components/editor/domEditing";
import type { PatchOperation } from "../utils/sourcePatcher";
import { trackStudioSaveFailure } from "../utils/studioSaveDiagnostics";
import { DomEditSaveQueueOpenError } from "../utils/domEditSaveQueue";
import type { PersistDomEditOperations } from "./domEditCommitTypes";

interface UseDomEditPositionPatchCommitParams {
  activeCompPath: string | null;
  persistDomEditOperations: PersistDomEditOperations;
  queueDomEditSave: (save: () => Promise<void>) => Promise<void>;
  showToast: (message: string, tone?: "error" | "info") => void;
}

interface PositionPatchOptions {
  label: string;
  coalesceKey: string;
  coalesceMs?: number;
  skipRefresh?: boolean;
}

export function useDomEditPositionPatchCommit({
  activeCompPath,
  persistDomEditOperations,
  queueDomEditSave,
  showToast,
}: UseDomEditPositionPatchCommitParams) {
  return useCallback(
    (selection: DomEditSelection, patches: PatchOperation[], options: PositionPatchOptions) => {
      return queueDomEditSave(async () => {
        await persistDomEditOperations(selection, patches, {
          label: options.label,
          coalesceKey: options.coalesceKey,
          coalesceMs: options.coalesceMs,
          skipRefresh: options.skipRefresh ?? true,
        });
      }).catch((error) => {
        // A paused save queue is not worth a toast: the paused-save banner is
        // already on screen, and one toast per blocked edit is what this branch
        // exists to prevent. It still has to REJECT, though. Swallowing it
        // resolved the commit, which skipped the caller's revert, so the element
        // stayed where the drag put it while nothing reached the file.
        if (error instanceof DomEditSaveQueueOpenError) throw error;
        showToast(error instanceof Error ? error.message : "Failed to save position");
        trackStudioSaveFailure({
          source: "dom_edit",
          error,
          filePath: selection.sourceFile ?? activeCompPath ?? "index.html",
          mutationType: "position",
          label: options.label,
          targetId: selection.id,
          targetSelector: selection.selector,
          targetSourceFile: selection.sourceFile,
        });
        throw error;
      });
    },
    [activeCompPath, persistDomEditOperations, queueDomEditSave, showToast],
  );
}
