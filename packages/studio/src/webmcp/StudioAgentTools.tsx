import { useCallback, useMemo } from "react";
import { useDomEditActionsContext, useDomEditSelectionContext } from "../contexts/DomEditContext";
import { useStudioShellContext } from "../contexts/StudioContext";
import { usePlayerStore } from "../player";
import { useStudioAgentTools, type StudioAgentToolsDeps } from "./useStudioAgentTools";
import type { StudioLookSnapshot } from "./tools/lookTools";

/**
 * Mounts Studio's WebMCP tool surface. Renders nothing.
 *
 * Lives inside `EditorShell` rather than `App` for two reasons: the DomEdit
 * contexts are only readable below `DomEditProvider`, which `App` renders, and
 * `App.tsx` sits three lines under the 600-line cap.
 *
 * The player store is read IMPERATIVELY through `getState()` rather than
 * subscribed to. Subscribing to `currentTime` would re-render this component on
 * every animation frame during playback for a value nothing here displays.
 */
export function StudioAgentTools() {
  const { projectId, activeCompPath, editHistory } = useStudioShellContext();
  const {
    domEditSelection,
    selectedGsapAnimations,
    gsapMultipleTimelines,
    gsapUnsupportedTimelinePattern,
  } = useDomEditSelectionContext();
  const { previewIframeRef, buildDomSelectionFromTarget, applyDomSelection } =
    useDomEditActionsContext();

  const getSnapshot = useCallback((): StudioLookSnapshot => {
    const player = usePlayerStore.getState();
    return {
      projectId,
      compositionPath: activeCompPath,
      currentTime: player.currentTime,
      duration: player.duration,
      isPlaying: player.isPlaying,
      elements: player.elements,
      selection: domEditSelection,
      selectionAnimationCount: selectedGsapAnimations.length,
      history: {
        canUndo: editHistory.canUndo,
        canRedo: editHistory.canRedo,
        undoLabel: editHistory.undoLabel ?? null,
        redoLabel: editHistory.redoLabel ?? null,
      },
    };
  }, [projectId, activeCompPath, domEditSelection, selectedGsapAnimations, editHistory]);

  const deps = useMemo<StudioAgentToolsDeps>(
    () => ({
      getSnapshot,
      getPreviewDocument: () => previewIframeRef.current?.contentDocument ?? null,
      buildSelection: (element) => buildDomSelectionFromTarget(element),
      applySelection: (selection) => applyDomSelection(selection, { revealPanel: true }),
      requestSeek: (time) => usePlayerStore.getState().requestSeek(time),
      readPlayhead: () => {
        const player = usePlayerStore.getState();
        return {
          currentTime: player.currentTime,
          duration: player.duration,
          isPlaying: player.isPlaying,
        };
      },
      getProjectId: () => projectId,
      getCompositionPath: () => activeCompPath,
      // HEAD, not GET: the tool only needs to know the frame renders. Pulling
      // the PNG here would download it once for nothing, since the agent
      // fetches the URL itself.
      probeFrame: async (url) => {
        try {
          const response = await fetch(url, { method: "HEAD" });
          return { ok: response.ok, status: response.status };
        } catch {
          return { ok: false, status: 0 };
        }
      },
      wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      getCurrentSelection: () => domEditSelection,
      getGsapDiagnostics: () => ({
        animations: selectedGsapAnimations,
        multipleTimelines: gsapMultipleTimelines,
        unsupportedTimelinePattern: gsapUnsupportedTimelinePattern,
      }),
    }),
    [
      getSnapshot,
      previewIframeRef,
      buildDomSelectionFromTarget,
      applyDomSelection,
      projectId,
      activeCompPath,
      domEditSelection,
      selectedGsapAnimations,
      gsapMultipleTimelines,
      gsapUnsupportedTimelinePattern,
    ],
  );

  useStudioAgentTools(deps);
  return null;
}
