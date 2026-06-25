import { useCallback } from "react";
import { getDomEditTargetKey, type DomEditSelection } from "../components/editor/domEditing";
import {
  applyStudioPathOffset,
  applyStudioBoxSize,
  applyStudioRotation,
  clearStudioPathOffset,
  clearStudioBoxSize,
  clearStudioRotation,
} from "../components/editor/manualEdits";
import {
  buildPathOffsetPatches,
  buildBoxSizePatches,
  buildRotationPatches,
  buildClearPathOffsetPatches,
  buildClearBoxSizePatches,
  buildClearRotationPatches,
} from "../components/editor/manualEditsDomPatches";
import type { PatchOperation } from "../utils/sourcePatcher";
import { isElementGsapTargeted } from "./gsapTargetCache";

const GSAP_CSS_FALLBACK_BLOCKED_MESSAGE =
  "This element is GSAP-animated — dragging via CSS would corrupt keyframes";

// ── Hook ──

interface UseDomGeometryCommitsParams {
  previewIframeRef: React.MutableRefObject<HTMLIFrameElement | null>;
  showToast: (message: string, tone?: "error" | "info") => void;
  commitPositionPatchToHtml: (
    selection: DomEditSelection,
    patches: PatchOperation[],
    options: { label: string; coalesceKey: string; skipRefresh?: boolean },
  ) => Promise<void>;
}

export function useDomGeometryCommits({
  previewIframeRef,
  showToast,
  commitPositionPatchToHtml,
}: UseDomGeometryCommitsParams) {
  const handleDomPathOffsetCommit = useCallback(
    (selection: DomEditSelection, next: { x: number; y: number }) => {
      // ponytail: GSAP-targeted elements are blocked (no SDK position-in-script op); CSS-path
      // elements fall through to commitPositionPatchToHtml → persistDomEditOperations →
      // onTrySdkPersist and are already SDK-cut-over as setStyle/setAttribute (§3.3 done).
      // Upgrade path for GSAP: add a moveElementGsap SDK op in a separate SDK PR.
      const gsapTargeted = isElementGsapTargeted(previewIframeRef.current, selection.element);
      if (gsapTargeted) {
        const error = new Error(GSAP_CSS_FALLBACK_BLOCKED_MESSAGE);
        showToast(error.message, "error");
        return Promise.reject(error);
      }
      applyStudioPathOffset(selection.element, next);
      return commitPositionPatchToHtml(selection, buildPathOffsetPatches(selection.element), {
        label: "Move layer",
        coalesceKey: `path-offset:${getDomEditTargetKey(selection)}`,
      });
    },
    [commitPositionPatchToHtml, previewIframeRef, showToast],
  );

  const handleDomBoxSizeCommit = useCallback(
    (selection: DomEditSelection, next: { width: number; height: number }) => {
      if (isElementGsapTargeted(previewIframeRef.current, selection.element)) {
        const error = new Error(GSAP_CSS_FALLBACK_BLOCKED_MESSAGE);
        showToast(error.message, "error");
        return Promise.reject(error);
      }
      applyStudioBoxSize(selection.element, next);
      return commitPositionPatchToHtml(selection, buildBoxSizePatches(selection.element), {
        label: "Resize layer box",
        coalesceKey: `box-size:${getDomEditTargetKey(selection)}`,
      });
    },
    [commitPositionPatchToHtml, previewIframeRef, showToast],
  );

  const handleDomRotationCommit = useCallback(
    (selection: DomEditSelection, next: { angle: number }) => {
      if (isElementGsapTargeted(previewIframeRef.current, selection.element)) {
        const error = new Error(GSAP_CSS_FALLBACK_BLOCKED_MESSAGE);
        showToast(error.message, "error");
        return Promise.reject(error);
      }
      applyStudioRotation(selection.element, next);
      return commitPositionPatchToHtml(selection, buildRotationPatches(selection.element), {
        label: "Rotate layer",
        coalesceKey: `rotation:${getDomEditTargetKey(selection)}`,
      });
    },
    [commitPositionPatchToHtml, previewIframeRef, showToast],
  );

  const handleDomManualEditsReset = useCallback(
    (selection: DomEditSelection) => {
      const element = selection.element;
      const clearPatches = [
        ...buildClearPathOffsetPatches(element),
        ...buildClearBoxSizePatches(element),
        ...buildClearRotationPatches(element),
      ];
      clearStudioPathOffset(element);
      clearStudioBoxSize(element);
      clearStudioRotation(element);
      // skipRefresh:false triggers reloadPreview() which re-syncs selection on load
      void commitPositionPatchToHtml(selection, clearPatches, {
        label: "Reset layer edits",
        coalesceKey: `manual-reset:${getDomEditTargetKey(selection)}`,
        skipRefresh: false,
      }).catch(() => undefined);
    },
    [commitPositionPatchToHtml],
  );

  return {
    handleDomPathOffsetCommit,
    handleDomBoxSizeCommit,
    handleDomRotationCommit,
    handleDomManualEditsReset,
  };
}
