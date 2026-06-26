import { useCallback, useRef } from "react";
import { liveTime, usePlayerStore } from "../player";
import { pauseStudioPreviewPlayback } from "../utils/studioPreviewHelpers";
import { STUDIO_PREVIEW_SELECTION_ENABLED } from "../components/editor/manualEditingAvailability";
import { type DomEditSelection } from "../components/editor/domEditing";

// ── Types ──

export interface UsePreviewInteractionParams {
  captionEditMode: boolean;
  compositionLoading: boolean;
  previewIframeRef: React.MutableRefObject<HTMLIFrameElement | null>;
  showToast: (message: string, tone?: "error" | "info") => void;

  // From useDomSelection
  applyDomSelection: (
    selection: DomEditSelection | null,
    options?: { revealPanel?: boolean; additive?: boolean; preserveGroup?: boolean },
  ) => void;
  resolveDomSelectionFromPreviewPoint: (
    clientX: number,
    clientY: number,
    options?: {
      preferClipAncestor?: boolean;
      skipSourceProbe?: boolean;
      activeGroupElement?: HTMLElement | null;
    },
  ) => Promise<DomEditSelection | null>;
  resolveAllDomSelectionsFromPreviewPoint: (
    clientX: number,
    clientY: number,
  ) => Promise<DomEditSelection[]>;
  updateDomEditHoverSelection: (selection: DomEditSelection | null) => void;
  /** Drill into a group (double-click on the canvas) so its children become selectable. */
  setActiveGroupElement: (el: HTMLElement | null) => void;

  onClickToSource?: (selection: DomEditSelection) => void;
}

interface ClickCycleState {
  x: number;
  y: number;
  candidates: DomEditSelection[];
  index: number;
  at: number;
}

const CYCLE_RADIUS_PX = 6;
const CYCLE_WINDOW_MS = 600;

// ── Hook ──

export function usePreviewInteraction({
  captionEditMode,
  compositionLoading,
  previewIframeRef,
  showToast,
  applyDomSelection,
  resolveDomSelectionFromPreviewPoint,
  resolveAllDomSelectionsFromPreviewPoint,
  updateDomEditHoverSelection,
  setActiveGroupElement,
  onClickToSource,
}: UsePreviewInteractionParams) {
  const cycleRef = useRef<ClickCycleState | null>(null);

  const handlePreviewCanvasMouseDown = useCallback(
    // fallow-ignore-next-line complexity
    async (e: React.MouseEvent<HTMLDivElement>, options?: { preferClipAncestor?: boolean }) => {
      if (!STUDIO_PREVIEW_SELECTION_ENABLED || captionEditMode || compositionLoading) return;

      // Double-click a group → drill into it and select the child under the
      // pointer (resolve with the group as the explicit drill-in scope, since the
      // activeGroupElement state hasn't re-rendered yet within this handler).
      if (e.detail >= 2 && !e.shiftKey) {
        const hit = await resolveDomSelectionFromPreviewPoint(e.clientX, e.clientY);
        if (hit?.element.hasAttribute("data-hf-group")) {
          e.preventDefault();
          e.stopPropagation();
          cycleRef.current = null;
          setActiveGroupElement(hit.element);
          const child = await resolveDomSelectionFromPreviewPoint(e.clientX, e.clientY, {
            activeGroupElement: hit.element,
          });
          applyDomSelection(child ?? hit);
          return;
        }
      }

      const now = Date.now();
      const prev = cycleRef.current;
      const dx = prev ? e.clientX - prev.x : Infinity;
      const dy = prev ? e.clientY - prev.y : Infinity;
      const sameSpot =
        prev !== null &&
        Math.sqrt(dx * dx + dy * dy) < CYCLE_RADIUS_PX &&
        now - prev.at < CYCLE_WINDOW_MS;

      if (e.shiftKey) {
        // Additive selection — no cycling
        cycleRef.current = null;
        const nextSelection = await resolveDomSelectionFromPreviewPoint(e.clientX, e.clientY, {
          preferClipAncestor: options?.preferClipAncestor ?? false,
        });
        if (!nextSelection) return;
        e.preventDefault();
        e.stopPropagation();
        applyDomSelection(nextSelection, { additive: true });
        return;
      }

      if (sameSpot && prev) {
        // Cycle to next candidate in z-stack
        const nextIndex = (prev.index + 1) % prev.candidates.length;
        const nextSel = prev.candidates[nextIndex];
        cycleRef.current = { ...prev, index: nextIndex, at: now };
        e.preventDefault();
        e.stopPropagation();
        applyDomSelection(nextSel);
        return;
      }

      // Fresh click — resolve topmost element
      const nextSelection = await resolveDomSelectionFromPreviewPoint(e.clientX, e.clientY, {
        preferClipAncestor: options?.preferClipAncestor ?? false,
      });
      if (!nextSelection) {
        cycleRef.current = null;
        applyDomSelection(null, { revealPanel: false });
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      applyDomSelection(nextSelection);

      if (!e.shiftKey && e.altKey && onClickToSource) {
        onClickToSource(nextSelection);
      }

      // Resolve all stacked candidates so a subsequent click at the same
      // position can cycle to the next layer (issues #1124, #1125).
      const all = await resolveAllDomSelectionsFromPreviewPoint(e.clientX, e.clientY);
      cycleRef.current =
        all.length > 1 ? { x: e.clientX, y: e.clientY, candidates: all, index: 0, at: now } : null;
    },
    [
      applyDomSelection,
      captionEditMode,
      compositionLoading,
      onClickToSource,
      resolveAllDomSelectionsFromPreviewPoint,
      resolveDomSelectionFromPreviewPoint,
      setActiveGroupElement,
    ],
  );

  const handlePreviewCanvasPointerMove = useCallback(
    // fallow-ignore-next-line complexity
    async (e: React.PointerEvent<HTMLDivElement>, options?: { preferClipAncestor?: boolean }) => {
      if (!STUDIO_PREVIEW_SELECTION_ENABLED || captionEditMode || compositionLoading) {
        updateDomEditHoverSelection(null);
        return null;
      }

      const nextSelection = await resolveDomSelectionFromPreviewPoint(e.clientX, e.clientY, {
        preferClipAncestor: options?.preferClipAncestor ?? false,
        skipSourceProbe: true,
      });
      updateDomEditHoverSelection(nextSelection);
      return nextSelection;
    },
    [
      captionEditMode,
      compositionLoading,
      resolveDomSelectionFromPreviewPoint,
      updateDomEditHoverSelection,
    ],
  );

  const handlePreviewCanvasPointerLeave = useCallback(() => {
    updateDomEditHoverSelection(null);
  }, [updateDomEditHoverSelection]);

  const handleBlockedDomMove = useCallback(
    (selection: DomEditSelection) => {
      showToast(
        selection.capabilities.reasonIfDisabled ??
          "This element can't be adjusted directly from the preview.",
        "info",
      );
    },
    [showToast],
  );

  const handleDomManualDragStart = useCallback(() => {
    const pausedTime = pauseStudioPreviewPlayback(previewIframeRef.current);
    const playerStore = usePlayerStore.getState();
    playerStore.setIsPlaying(false);
    if (pausedTime != null) {
      playerStore.setCurrentTime(pausedTime);
      liveTime.notify(pausedTime);
    }
  }, [previewIframeRef]);

  return {
    handlePreviewCanvasMouseDown,
    handlePreviewCanvasPointerMove,
    handlePreviewCanvasPointerLeave,
    handleBlockedDomMove,
    handleDomManualDragStart,
  };
}
