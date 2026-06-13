import { useCallback } from "react";
import { STUDIO_GSAP_DRAG_INTERCEPT_ENABLED } from "../components/editor/manualEditingAvailability";
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
import type { DomEditGroupPathOffsetCommit } from "../components/editor/DomEditOverlay";
import type { PatchOperation } from "../utils/sourcePatcher";

export const GSAP_CSS_FALLBACK_BLOCKED_MESSAGE =
  "This element is GSAP-animated — dragging via CSS would corrupt keyframes";

// ── Helpers ──

type TimelineLike = { getChildren?: (nested: boolean) => Array<{ targets?: () => Element[] }> };

// fallow-ignore-next-line complexity
function isElementGsapTargeted(iframe: HTMLIFrameElement | null, element: HTMLElement): boolean {
  // When the GSAP drag intercept is disabled for debugging, treat every
  // element as un-targeted so commits take the plain CSS persist path.
  if (!STUDIO_GSAP_DRAG_INTERCEPT_ENABLED) return false;
  if (!iframe?.contentWindow) return false;
  let timelines: Record<string, TimelineLike> | undefined;
  try {
    timelines = (iframe.contentWindow as Window & { __timelines?: Record<string, TimelineLike> })
      .__timelines;
  } catch {
    return false;
  }
  if (!timelines) return false;
  const id = element.id;
  for (const tl of Object.values(timelines)) {
    if (!tl?.getChildren) continue;
    try {
      for (const child of tl.getChildren(true)) {
        if (!child.targets) continue;
        for (const t of child.targets()) {
          if (t === element || (id && t.id === id)) return true;
        }
      }
    } catch {
      continue;
    }
  }
  return false;
}

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
      if (isElementGsapTargeted(previewIframeRef.current, selection.element)) {
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

  const handleDomGroupPathOffsetCommit = useCallback(
    (updates: DomEditGroupPathOffsetCommit[]) => {
      if (updates.length === 0) return Promise.resolve();
      const blockedUpdate = updates.find(({ selection }) =>
        isElementGsapTargeted(previewIframeRef.current, selection.element),
      );
      if (blockedUpdate) {
        const error = new Error(GSAP_CSS_FALLBACK_BLOCKED_MESSAGE);
        showToast(error.message, "error");
        return Promise.reject(error);
      }
      const coalesceKey = updates
        .map((u) => getDomEditTargetKey(u.selection))
        .sort()
        .join(":");
      const saves = updates.map(({ selection, next }) => {
        applyStudioPathOffset(selection.element, next);
        return commitPositionPatchToHtml(selection, buildPathOffsetPatches(selection.element), {
          label: `Move ${updates.length} layers`,
          coalesceKey: `group-path-offset:${coalesceKey}`,
        });
      });
      return Promise.all(saves).then(() => undefined);
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
    handleDomGroupPathOffsetCommit,
    handleDomBoxSizeCommit,
    handleDomRotationCommit,
    handleDomManualEditsReset,
  };
}
