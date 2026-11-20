import { useCallback, type RefObject } from "react";
import type { DomEditSelection } from "../components/editor/domEditing";
import { previewDraftLive } from "../components/editor/previewDrafts";
import {
  editSealedSelection,
  showSavedStylesOnStandIn,
} from "../components/editor/previewSelection";
import { afterSealedDraw } from "../player/lib/previewElements";
import type { PatchOperation } from "../utils/sourcePatcher";
import { trackStudioSaveFailure } from "../utils/studioSaveDiagnostics";
import { DomEditSaveQueueOpenError } from "../utils/domEditSaveQueue";
import type { PersistDomEditOperations } from "./domEditCommitTypes";
import { wasAlreadyToasted } from "./domEditPersistFailure";

interface UseDomEditPositionPatchCommitParams {
  activeCompPath: string | null;
  previewIframeRef: RefObject<HTMLIFrameElement | null>;
  persistDomEditOperations: PersistDomEditOperations;
  showToast: (message: string, tone?: "error" | "info") => void;
}

type PositionPatchOptions = {
  label: string;
  coalesceKey: string;
  coalesceMs?: number;
  skipRefresh?: boolean;
  deferRender?: boolean;
};

/** A sealed frame shows the patch's own styles and attributes, unless a gesture's draft already does. */
function drawOnSealedFrame(
  iframe: HTMLIFrameElement | null,
  selection: DomEditSelection,
  patches: PatchOperation[],
) {
  if (previewDraftLive(selection.element)) return null;
  const own = patches.filter((p) => p.childSelector === undefined && p.childIndex === undefined);
  const entries = (type: PatchOperation["type"]) =>
    own.filter((p) => p.type === type).map((p): [string, string | null] => [p.property, p.value]);
  const styles = entries("inline-style");
  const edit = editSealedSelection(iframe, selection, {
    styles,
    attributes: entries("attribute"),
  });
  const shown = styles.filter((entry): entry is [string, string] => entry[1] !== null);
  if (edit) showSavedStylesOnStandIn(selection.element, shown);
  return edit;
}

export function useDomEditPositionPatchCommit({
  activeCompPath,
  previewIframeRef,
  persistDomEditOperations,
  showToast,
}: UseDomEditPositionPatchCommitParams) {
  return useCallback(
    (selection: DomEditSelection, patches: PatchOperation[], options: PositionPatchOptions) => {
      const sealedEdit = drawOnSealedFrame(previewIframeRef.current, selection, patches);
      const saved = afterSealedDraw(sealedEdit, (drawn) =>
        persistDomEditOperations(selection, patches, {
          label: options.label,
          coalesceKey: options.coalesceKey,
          coalesceMs: options.coalesceMs,
          skipRefresh: (options.skipRefresh ?? true) && drawn,
          deferRender: options.deferRender,
        }),
      );
      return Promise.resolve(saved).catch((error) => {
        sealedEdit?.restore();
        // The paused-save banner already explains this refusal. Rethrow so the
        // caller reverts the preview instead of treating an unsaved edit as committed.
        if (error instanceof DomEditSaveQueueOpenError) throw error;
        if (!wasAlreadyToasted(error)) {
          showToast(error instanceof Error ? error.message : "Failed to save position");
        }
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
    [activeCompPath, persistDomEditOperations, previewIframeRef, showToast],
  );
}
