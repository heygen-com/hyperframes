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
  const { domEditSelection } = useDomEditSelectionContext();

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
      selectedElementIds: [...player.selectedElementIds],
      history: {
        canUndo: editHistory.canUndo,
        canRedo: editHistory.canRedo,
        undoLabel: editHistory.undoLabel ?? null,
        redoLabel: editHistory.redoLabel ?? null,
      },
      // TODO(webmcp): the save-queue and external-conflict states live on
      // App's previewPersistence and externalFileChanges, which are not on any
      // context this component can read. Until they are, `canWrite` is
      // optimistic. The write tools land in a later unit and MUST NOT ship
      // trusting this field; they need the real guard.
      writeBlockedReason: null,
    };
  }, [projectId, activeCompPath, domEditSelection, editHistory]);

  useStudioAgentTools({ getSnapshot });
  return null;
}
