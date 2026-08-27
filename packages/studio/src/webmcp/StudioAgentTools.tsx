import { useCallback } from "react";
import { useDomEditSelectionContext } from "../contexts/DomEditContext";
import { useStudioShellContext } from "../contexts/StudioContext";
import { usePlayerStore } from "../player";
import { useStudioAgentTools } from "./useStudioAgentTools";
import type { StudioLookSnapshot } from "./tools/lookTools";

/**
 * Mounts Studio's WebMCP tool surface. Renders nothing.
 *
 * Lives inside `EditorShell` rather than `App` for two reasons: the DomEdit
 * contexts are only readable below `DomEditProvider`, which `App` renders, and
 * `App.tsx` sits three lines under the 600-line cap.
 *
 * The player store is read IMPERATIVELY through `getState()` inside the
 * snapshot callback rather than subscribed to. Subscribing to `currentTime`
 * would re-render this component on every animation frame during playback for
 * a value nothing here displays.
 */
export function StudioAgentTools() {
  const { projectId, activeCompPath, editHistory } = useStudioShellContext();
  const { domEditSelection, selectedGsapAnimations } = useDomEditSelectionContext();

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

  useStudioAgentTools({ getSnapshot });
  return null;
}
