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
          skipRefresh: options.skipRefresh ?? true,
        });
      }).catch((error) => {
        if (error instanceof DomEditSaveQueueOpenError) return;
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
