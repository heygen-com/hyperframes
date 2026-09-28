import { useCallback, useMemo, useRef, useState } from "react";
import type { DomEditSelection } from "../components/editor/domEditing";
import type { DomEditGroupPathOffsetCommit } from "../components/editor/DomEditOverlay";
import { createDomEditSaveQueue, type DomEditSaveDrainResult } from "../utils/domEditSaveQueue";
import type { DomEditCommitOutcome } from "./domEditCommitRunner";
import { useDomEditPersist } from "./useDomEditPersist";
import { useDomEditPositionPatchCommit } from "./useDomEditPositionPatchCommit";
import type { UseDomStyleCommitOptions } from "./useDomStyleCommit";
import { useDomGeometryCommits } from "./useDomGeometryCommits";
import { useGsapAnimationFetchFallback } from "./useGsapAnimationFetchFallback";
import { useGsapAwareEditing } from "./useGsapAwareEditing";
import { useGsapInteractionFailureTelemetry } from "./useGsapInteractionFailureTelemetry";
import { useGsapScriptCommits } from "./useGsapScriptCommits";
import { useGsapCacheVersion } from "./useGsapTweenCache";
import { useMountEffect } from "./useMountEffect";

export interface UseDomGeometryCommitOptions extends UseDomStyleCommitOptions {
  /** Called when a save cannot patch the live preview in place; defaults to reloading the iframe. */
  reloadPreview?: () => void;
}

export interface DomGeometryCommits {
  commitPathOffset: (
    selection: DomEditSelection,
    next: { x: number; y: number },
    modifiers?: { altKey?: boolean },
  ) => Promise<DomEditCommitOutcome>;
  commitGroupPathOffset: (updates: DomEditGroupPathOffsetCommit[]) => Promise<DomEditCommitOutcome>;
  commitBoxSize: (
    selection: DomEditSelection,
    next: { width: number; height: number },
    offset?: { x: number; y: number },
    restore?: () => void,
  ) => Promise<DomEditCommitOutcome>;
  commitRotation: (
    selection: DomEditSelection,
    next: { angle: number },
  ) => Promise<DomEditCommitOutcome>;
  waitForPendingSaves: () => Promise<DomEditSaveDrainResult>;
}

const noop = () => {};

/**
 * Saves canvas moves, resizes and rotations through Studio's own GSAP-aware commits, for a host
 * without the editor. A failed save rejects, so DomEditOverlay undoes the live gesture.
 */
export function useDomGeometryCommit({
  projectId,
  iframeRef,
  writeProjectFile,
  recordEdit,
  activeCompPath = null,
  showToast = noop,
  reloadPreview,
}: UseDomGeometryCommitOptions): DomGeometryCommits {
  const projectIdRef = useRef(projectId);
  projectIdRef.current = projectId;
  const [queue] = useState(createDomEditSaveQueue);
  useMountEffect(() => () => queue.destroy());
  const editHistory = useMemo(() => ({ recordEdit }), [recordEdit]);
  const reload = useCallback(
    () => (reloadPreview ? reloadPreview() : iframeRef.current?.contentWindow?.location.reload()),
    [reloadPreview, iframeRef],
  );
  const persistDomEditOperations = useDomEditPersist({
    activeCompPath,
    previewIframeRef: iframeRef,
    showToast,
    queueDomEditSave: queue.enqueue,
    writeProjectFile,
    editHistory,
    projectIdRef,
    reloadPreview: reload,
  });
  const commitPositionPatchToHtml = useDomEditPositionPatchCommit({
    activeCompPath,
    persistDomEditOperations,
    showToast,
  });
  const { handleDomBoxSizeCommit } = useDomGeometryCommits({
    previewIframeRef: iframeRef,
    showToast,
    commitPositionPatchToHtml,
    readOnlyPreview: false,
  });
  const { bump: bumpGsapCache } = useGsapCacheVersion();
  const gsap = useGsapScriptCommits({
    projectIdRef,
    activeCompPath,
    previewIframeRef: iframeRef,
    editHistory,
    reloadPreview: reload,
    onCacheInvalidate: bumpGsapCache,
    showToast,
    writeProjectFile,
  });
  const makeFetchFallback = useGsapAnimationFetchFallback(projectId);
  const trackGsapInteractionFailure = useGsapInteractionFailureTelemetry(activeCompPath, showToast);
  const aware = useGsapAwareEditing({
    // The host owns selection, so every gesture reads its element's animations from the server.
    domEditSelection: null,
    selectedGsapAnimations: [],
    gsapCommitMutation: gsap.commitMutation,
    previewIframeRef: iframeRef,
    showToast,
    bumpGsapCache,
    makeFetchFallback,
    trackGsapInteractionFailure,
    handleDomBoxSizeCommit,
    addGsapAnimation: gsap.addGsapAnimation,
    convertToKeyframes: gsap.convertToKeyframes,
    setArcPath: gsap.setArcPath,
    updateArcSegment: gsap.updateArcSegment,
  });
  const saved = useCallback(
    async (commit: () => Promise<void>): Promise<DomEditCommitOutcome> => {
      if (!projectIdRef.current) throw new Error("No project is open");
      // Each gesture is the user's own retry, so a pause left by an earlier failed save never blocks it.
      queue.reset();
      await commit();
      return { ok: true };
    },
    [queue],
  );
  const {
    handleGsapAwarePathOffsetCommit,
    handleGsapAwareGroupPathOffsetCommit,
    handleGsapAwareBoxSizeCommit,
    handleGsapAwareRotationCommit,
  } = aware;
  return useMemo(
    () => ({
      commitPathOffset: (selection, next, modifiers) =>
        saved(() => handleGsapAwarePathOffsetCommit(selection, next, modifiers)),
      commitGroupPathOffset: (updates) => saved(() => handleGsapAwareGroupPathOffsetCommit(updates)),
      commitBoxSize: (selection, next, offset, restore) =>
        saved(() => handleGsapAwareBoxSizeCommit(selection, next, offset, restore)),
      commitRotation: (selection, next) =>
        saved(() => handleGsapAwareRotationCommit(selection, next)),
      waitForPendingSaves: queue.waitForIdle,
    }),
    [
      saved,
      queue,
      handleGsapAwarePathOffsetCommit,
      handleGsapAwareGroupPathOffsetCommit,
      handleGsapAwareBoxSizeCommit,
      handleGsapAwareRotationCommit,
    ],
  );
}
