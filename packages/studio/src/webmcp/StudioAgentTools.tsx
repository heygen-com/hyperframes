import { useCallback, useEffect, useMemo } from "react";
import { useDomEditActionsContext, useDomEditSelectionContext } from "../contexts/DomEditContext";
import { useStudioShellContext } from "../contexts/StudioContext";
import { usePlayerStore } from "../player";
import { useStudioAgentTools, type StudioAgentToolsDeps } from "./useStudioAgentTools";
import type { StudioLookSnapshot } from "./tools/lookTools";
import { agentPreview } from "./agentPreview";
import { studioEditLifecycle } from "./writeCoordinator";
import type { DomEditSelection } from "../components/editor/domEditingTypes";
import {
  applyStudioBoxSizeDraft,
  captureStudioBoxSize,
  restoreStudioBoxSize,
} from "../components/editor/manualEdits";
import { studioApiFetch } from "../utils/studioApiFetch";

type ResizeCommit = (
  selection: DomEditSelection,
  next: { width: number; height: number },
  offset?: { x: number; y: number },
  restore?: () => void,
) => Promise<void | import("../utils/previewFeatureUsage").GeometryCommitResult>;

export function resizeSelectionFromAgent(
  selection: DomEditSelection,
  next: { width: number; height: number },
  commit: ResizeCommit,
): Promise<void | import("../utils/previewFeatureUsage").GeometryCommitResult> {
  const previous = captureStudioBoxSize(selection.element);
  applyStudioBoxSizeDraft(selection.element, next);
  return commit(selection, next, undefined, () => {
    restoreStudioBoxSize(selection.element, previous);
  });
}

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
  const { projectId, activeCompPath, editHistory, writeBlockedReason } = useStudioShellContext();
  const {
    domEditSelection,
    activeGroupElement,
    selectedGsapAnimations,
    gsapMultipleTimelines,
    gsapUnsupportedTimelinePattern,
  } = useDomEditSelectionContext();
  const {
    previewIframeRef,
    buildDomSelectionFromTarget,
    applyDomSelection,
    handleDomTextCommitForSelection,
    handleDomStyleCommitForSelection,
    handleDomPathOffsetCommit,
    handleDomBoxSizeCommit,
    handleDomRotationCommit,
    handleGsapAddAnimation,
    handleGsapUpdateMeta,
    handleGsapAddKeyframeBatch,
    handleGsapDeleteAnimation,
    getGsapAnimationsForSelection,
  } = useDomEditActionsContext();

  useEffect(() => {
    studioEditLifecycle.activateProject(projectId);
    return () => studioEditLifecycle.reset();
  }, [projectId]);

  const preview = useMemo(
    () => agentPreview(() => previewIframeRef.current, activeCompPath),
    [previewIframeRef, activeCompPath],
  );

  const getSnapshot = useCallback(async (): Promise<StudioLookSnapshot> => {
    const player = usePlayerStore.getState();
    return {
      projectId,
      compositionPath: activeCompPath,
      currentTime: player.currentTime,
      duration: player.duration,
      isPlaying: player.isPlaying,
      elements: player.elements,
      scene: await preview.scene(activeGroupElement),
      selection: domEditSelection,
      selectionAnimationCount: selectedGsapAnimations.length,
      history: {
        canUndo: editHistory.canUndo,
        canRedo: editHistory.canRedo,
        undoLabel: editHistory.undoLabel ?? null,
        redoLabel: editHistory.redoLabel ?? null,
      },
    };
  }, [
    projectId,
    activeCompPath,
    domEditSelection,
    activeGroupElement,
    selectedGsapAnimations,
    editHistory,
    preview,
  ]);

  const deps = useMemo<StudioAgentToolsDeps>(
    () => ({
      getSnapshot,
      preview,
      buildSelection: (element) => buildDomSelectionFromTarget(element, { exactTarget: true }),
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
          const response = await studioApiFetch(url, { method: "HEAD" });
          return { ok: response.ok, status: response.status };
        } catch {
          return { ok: false, status: 0 };
        }
      },
      wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      getCurrentSelection: () => domEditSelection,
      getWriteBlockedReason: () => writeBlockedReason,
      setText: (selection, value, fieldKey) =>
        handleDomTextCommitForSelection(selection, value, fieldKey),
      setStyle: (selection, property, value) =>
        handleDomStyleCommitForSelection(selection, property, value),
      // Measured, not authored: the tool compares this before and after to
      // tell a real change from a handler that did nothing and resolved.
      readNow: preview.readNow,
      moveTo: (selection, next) => handleDomPathOffsetCommit(selection, next),
      resizeTo: (selection, next) =>
        resizeSelectionFromAgent(selection, next, handleDomBoxSizeCommit),
      rotateTo: (selection, next) => handleDomRotationCommit(selection, next),
      addAnimation: (selection, method) => handleGsapAddAnimation(method, selection),
      updateAnimation: (selection, animationId, updates) =>
        handleGsapUpdateMeta(animationId, updates, selection),
      addKeyframe: (selection, animationId, percent, properties) =>
        handleGsapAddKeyframeBatch(animationId, percent, properties, undefined, selection),
      deleteAnimation: (selection, animationId) =>
        handleGsapDeleteAnimation(animationId, selection),
      getAnimationsForSelection: async (selection) =>
        await getGsapAnimationsForSelection(selection),
      getGsapDiagnostics: () => ({
        animations: selectedGsapAnimations,
        multipleTimelines: gsapMultipleTimelines,
        unsupportedTimelinePattern: gsapUnsupportedTimelinePattern,
      }),
    }),
    [
      getSnapshot,
      preview,
      buildDomSelectionFromTarget,
      applyDomSelection,
      projectId,
      activeCompPath,
      writeBlockedReason,
      handleDomTextCommitForSelection,
      handleDomStyleCommitForSelection,
      handleDomPathOffsetCommit,
      handleDomBoxSizeCommit,
      handleDomRotationCommit,
      handleGsapAddAnimation,
      handleGsapUpdateMeta,
      handleGsapAddKeyframeBatch,
      handleGsapDeleteAnimation,
      getGsapAnimationsForSelection,
      domEditSelection,
      selectedGsapAnimations,
      gsapMultipleTimelines,
      gsapUnsupportedTimelinePattern,
    ],
  );

  useStudioAgentTools(deps);
  return null;
}
