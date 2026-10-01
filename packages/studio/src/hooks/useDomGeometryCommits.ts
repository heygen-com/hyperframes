import { useCallback } from "react";
import { getDomEditTargetKey, type DomEditSelection } from "../components/editor/domEditing";
import {
  applyStudioPathOffset,
  applyStudioBoxSize,
  captureStudioPathOffset,
  captureStudioBoxSize,
  captureStudioRotation,
  restoreStudioPathOffset,
  restoreStudioBoxSize,
  restoreStudioRotation,
  clearStudioPathOffset,
  clearStudioBoxSize,
  clearStudioRotation,
} from "../components/editor/manualEdits";
import { stageElementOffset } from "./elementOffsetStager";
import { savePlainRotation } from "./plainRotation";
import { prepareCropResize } from "../components/editor/cropResize";
import { translatePatch, writeTranslatePx } from "../components/editor/plainTranslate";
import {
  buildPathOffsetPatches,
  buildBoxSizePatches,
  buildClearPathOffsetPatches,
  buildClearBoxSizePatches,
  buildClearRotationPatches,
} from "../components/editor/manualEditsDomPatches";
import type { PatchOperation } from "../utils/sourcePatcher";
import { isElementGsapTargeted } from "./gsapTargetCache";

const GSAP_CSS_FALLBACK_BLOCKED_MESSAGE =
  "This element is GSAP-animated — dragging via CSS would corrupt keyframes";

function rejectGsapCssFallback(
  selection: DomEditSelection,
  previewIframeRef: React.MutableRefObject<HTMLIFrameElement | null>,
  showToast: (message: string, tone?: "error" | "info") => void,
): Promise<never> | null {
  if (!isElementGsapTargeted(previewIframeRef.current, selection.element)) return null;
  const error = new Error(GSAP_CSS_FALLBACK_BLOCKED_MESSAGE);
  showToast(error.message, "error");
  return Promise.reject(error);
}

// ── Hook ──

export interface UseDomGeometryCommitsParams {
  previewIframeRef: React.MutableRefObject<HTMLIFrameElement | null>;
  showToast: (message: string, tone?: "error" | "info") => void;
  commitPositionPatchToHtml: (
    selection: DomEditSelection,
    patches: PatchOperation[],
    options: { label: string; coalesceKey: string; coalesceMs?: number; skipRefresh?: boolean },
  ) => Promise<void>;
  readOnlyPreview: boolean;
}

export function useDomGeometryCommits({
  previewIframeRef,
  showToast,
  commitPositionPatchToHtml,
  readOnlyPreview,
}: UseDomGeometryCommitsParams) {
  const stageElementPositionOffset = useCallback(
    (
      selection: DomEditSelection,
      next: { x: number; y: number },
      plainTranslate: boolean,
      coalesceKey?: string,
    ) =>
      stageElementOffset(
        { commitPositionPatchToHtml, showToast, readOnlyPreview },
        selection,
        next,
        plainTranslate,
        coalesceKey,
      ),
    [commitPositionPatchToHtml, readOnlyPreview, showToast],
  );

  const handleDomPathOffsetCommit = useCallback(
    (selection: DomEditSelection, next: { x: number; y: number }) => {
      if (readOnlyPreview) return Promise.resolve();
      // ponytail: GSAP-targeted elements are blocked (no SDK position-in-script op); CSS-path
      // elements fall through to commitPositionPatchToHtml → persistDomEditOperations →
      // onTrySdkPersist and are already SDK-cut-over as setStyle/setAttribute (§3.3 done).
      // Upgrade path for GSAP: add a moveElementGsap SDK op in a separate SDK PR.
      const gsapFallback = rejectGsapCssFallback(selection, previewIframeRef, showToast);
      if (gsapFallback) return gsapFallback;
      const before = captureStudioPathOffset(selection.element);
      applyStudioPathOffset(selection.element, next);
      return commitPositionPatchToHtml(selection, buildPathOffsetPatches(selection.element), {
        label: "Move layer",
        coalesceKey: `path-offset:${getDomEditTargetKey(selection)}`,
      }).catch((error) => {
        restoreStudioPathOffset(selection.element, before);
        throw error;
      });
    },
    [commitPositionPatchToHtml, previewIframeRef, showToast, readOnlyPreview],
  );

  const handleDomBoxSizeCommit = useCallback(
    (
      selection: DomEditSelection,
      next: { width: number; height: number },
      offset?: { x: number; y: number },
      restore?: () => void,
    ) => {
      if (readOnlyPreview) return Promise.resolve();
      const element = selection.element;
      const beforeSize = captureStudioBoxSize(element);
      const beforeTranslate = element.style.getPropertyValue("translate");
      const stageCrop = prepareCropResize(element);
      applyStudioBoxSize(element, next);
      const crop = stageCrop();
      // One commit, one undo entry: the size, the crop that follows it, and the translate
      // (as a move writes it) that keeps the centre planted.
      const patches = buildBoxSizePatches(element);
      if (crop) patches.push(crop.patch);
      if (offset) {
        writeTranslatePx(element, offset);
        patches.push(translatePatch(offset));
      }
      return commitPositionPatchToHtml(selection, patches, {
        label: "Resize layer box",
        coalesceKey: `box-size:${getDomEditTargetKey(selection)}`,
      }).catch((error) => {
        restoreStudioBoxSize(element, beforeSize);
        if (offset) element.style.setProperty("translate", beforeTranslate);
        crop?.revert();
        restore?.();
        throw error;
      });
    },
    [commitPositionPatchToHtml, readOnlyPreview],
  );

  const handleDomRotationCommit = useCallback(
    (selection: DomEditSelection, next: { angle: number }) =>
      savePlainRotation({ commitPositionPatchToHtml, readOnlyPreview }, selection, next),
    [commitPositionPatchToHtml, readOnlyPreview],
  );

  const handleDomManualEditsReset = useCallback(
    (selection: DomEditSelection) => {
      const element = selection.element;
      const beforeOffset = captureStudioPathOffset(element);
      const beforeSize = captureStudioBoxSize(element);
      const beforeRotation = captureStudioRotation(element);
      const clearPatches = [
        ...buildClearPathOffsetPatches(element),
        ...buildClearBoxSizePatches(element),
        ...buildClearRotationPatches(element),
      ];
      clearStudioPathOffset(element);
      clearStudioBoxSize(element);
      clearStudioRotation(element);
      // skipRefresh:false triggers reloadPreview() which re-syncs selection on load
      return commitPositionPatchToHtml(selection, clearPatches, {
        label: "Reset layer edits",
        coalesceKey: `manual-reset:${getDomEditTargetKey(selection)}`,
        skipRefresh: false,
      }).catch((error) => {
        restoreStudioPathOffset(element, beforeOffset);
        restoreStudioBoxSize(element, beforeSize);
        restoreStudioRotation(element, beforeRotation);
        throw error;
      });
    },
    [commitPositionPatchToHtml],
  );

  return {
    stageElementPositionOffset,
    handleDomPathOffsetCommit,
    handleDomBoxSizeCommit,
    handleDomRotationCommit,
    handleDomManualEditsReset,
  };
}
