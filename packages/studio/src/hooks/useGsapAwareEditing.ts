/**
 * GSAP-aware move/resize/rotation wrappers that intercept geometry commits
 * for animated elements and route them through script mutation instead of
 * CSS patching. Also exposes the animated-property commit, arc-path ops,
 * and the thin `commitMutation` facade.
 *
 * Extracted from useDomEditSession to isolate the GSAP intercept routing
 * from the rest of the editing orchestration.
 */
import { useCallback } from "react";
import { editLog } from "../utils/editDebugLog";
import type { GsapAnimation } from "@hyperframes/core/gsap-parser";
import type { DomEditSelection } from "../components/editor/domEditingTypes";
import {
  tryGsapDragIntercept,
  tryGsapResizeIntercept,
  tryGsapRotationIntercept,
} from "./gsapRuntimeBridge";
import { useAnimatedPropertyCommit } from "./useAnimatedPropertyCommit";
import {
  useGsapSaveFailureTelemetry,
  useSafeGsapCommitMutation,
} from "./useSafeGsapCommitMutation";
import type { CommitMutation } from "./gsapScriptCommitTypes";

export interface UseGsapAwareEditingParams {
  domEditSelection: DomEditSelection | null;
  selectedGsapAnimations: GsapAnimation[];
  gsapCommitMutation: CommitMutation | null;
  previewIframeRef: React.RefObject<HTMLIFrameElement | null>;
  showToast: (message: string, tone?: "error" | "info") => void;
  bumpGsapCache: () => void;
  makeFetchFallback: (selection: DomEditSelection) => () => Promise<GsapAnimation[]>;
  trackGsapInteractionFailure: (
    error: unknown,
    selection: DomEditSelection,
    mutationType: string,
    label: string,
  ) => void;
  // DOM fallbacks (from useDomEditCommits)
  handleDomBoxSizeCommit: (
    selection: DomEditSelection,
    next: { width: number; height: number },
  ) => Promise<void>;
  // GSAP script commit ops (from useGsapScriptCommits)
  addGsapAnimation: (
    sel: DomEditSelection,
    method: "to" | "from" | "set" | "fromTo",
    time?: number,
  ) => Promise<void>;
  convertToKeyframes: (sel: DomEditSelection, animId: string) => void;
  setArcPath: (
    sel: DomEditSelection,
    animId: string,
    config: {
      enabled: boolean;
      autoRotate?: boolean | number;
      segments?: Array<{
        curviness: number;
        cp1?: { x: number; y: number };
        cp2?: { x: number; y: number };
      }>;
    },
  ) => void;
  updateArcSegment: (
    sel: DomEditSelection,
    animId: string,
    segmentIndex: number,
    update: {
      curviness?: number;
      cp1?: { x: number; y: number };
      cp2?: { x: number; y: number };
    },
  ) => void;
}

export function useGsapAwareEditing({
  domEditSelection,
  selectedGsapAnimations,
  gsapCommitMutation,
  previewIframeRef,
  showToast,
  bumpGsapCache,
  makeFetchFallback,
  trackGsapInteractionFailure,
  handleDomBoxSizeCommit,
  addGsapAnimation,
  convertToKeyframes,
  setArcPath,
  updateArcSegment,
}: UseGsapAwareEditingParams) {
  // ── GSAP-aware geometry commits ──

  const handleGsapAwarePathOffsetCommit = useCallback(
    async (
      selection: DomEditSelection,
      next: { x: number; y: number },
      modifiers?: { altKey?: boolean },
    ) => {
      editLog("manual-drag:move", { id: selection.id, next, altKey: modifiers?.altKey });
      if (gsapCommitMutation) {
        try {
          await tryGsapDragIntercept(
            selection,
            next,
            selectedGsapAnimations,
            previewIframeRef.current,
            gsapCommitMutation,
            makeFetchFallback(selection),
            modifiers,
          );
        } catch (error) {
          trackGsapInteractionFailure(error, selection, "drag", "Move animated layer");
          throw error;
        }
      }
    },
    [
      selectedGsapAnimations,
      gsapCommitMutation,
      previewIframeRef,
      makeFetchFallback,
      trackGsapInteractionFailure,
    ],
  );

  const handleGsapAwareBoxSizeCommit = useCallback(
    async (selection: DomEditSelection, next: { width: number; height: number }) => {
      editLog("manual-drag:resize", { id: selection.id, next });
      if (gsapCommitMutation) {
        try {
          const handled = await tryGsapResizeIntercept(
            selection,
            next,
            selectedGsapAnimations,
            previewIframeRef.current,
            gsapCommitMutation,
            makeFetchFallback(selection),
          );
          if (handled) return;
        } catch (error) {
          trackGsapInteractionFailure(error, selection, "resize", "Resize animated layer");
          throw error;
        }
      }
      return handleDomBoxSizeCommit(selection, next);
    },
    [
      handleDomBoxSizeCommit,
      selectedGsapAnimations,
      gsapCommitMutation,
      previewIframeRef,
      makeFetchFallback,
      trackGsapInteractionFailure,
    ],
  );

  const handleGsapAwareRotationCommit = useCallback(
    async (selection: DomEditSelection, next: { angle: number }) => {
      editLog("manual-drag:rotate", { id: selection.id, next });
      if (gsapCommitMutation) {
        try {
          // Single source of truth for rotation too: tryGsapRotationIntercept handles
          // tweened elements (keyframes) and static ones (a tl.set), so there's no
          // CSS-var fallback. It returns false only for a selectorless element (no-op).
          await tryGsapRotationIntercept(
            selection,
            next.angle,
            selectedGsapAnimations,
            previewIframeRef.current,
            gsapCommitMutation,
            makeFetchFallback(selection),
          );
        } catch (error) {
          trackGsapInteractionFailure(error, selection, "rotation", "Rotate animated layer");
          throw error;
        }
      }
    },
    [
      selectedGsapAnimations,
      gsapCommitMutation,
      previewIframeRef,
      makeFetchFallback,
      trackGsapInteractionFailure,
    ],
  );

  // ── Animated property commit ──

  const commitAnimatedProperty = useAnimatedPropertyCommit({
    selectedGsapAnimations,
    gsapCommitMutation,
    addGsapAnimation: (sel, method, time) => addGsapAnimation(sel, method, time),
    convertToKeyframes: (sel, animId) => convertToKeyframes(sel, animId),
    previewIframeRef,
    bumpGsapCache,
  });

  // ── Arc path wrappers ──

  const handleSetArcPath = useCallback(
    (animId: string, config: Parameters<typeof setArcPath>[2]) => {
      if (!domEditSelection) return;
      setArcPath(domEditSelection, animId, config);
    },
    [domEditSelection, setArcPath],
  );

  const handleUpdateArcSegment = useCallback(
    (animId: string, segmentIndex: number, update: Parameters<typeof updateArcSegment>[3]) => {
      if (!domEditSelection) return;
      updateArcSegment(domEditSelection, animId, segmentIndex, update);
    },
    [domEditSelection, updateArcSegment],
  );

  // ── Thin commitMutation facade ──
  // Routes through the canonical safe wrapper so a server-save failure surfaces a
  // toast + save telemetry instead of silently reverting — parity with the
  // arc/keyframe/animation ops that all go through useSafeGsapCommitMutation.

  const noopCommit = useCallback<CommitMutation>(async () => {}, []);
  const trackGsapSaveFailure = useGsapSaveFailureTelemetry(null);
  const safeGsapCommit = useSafeGsapCommitMutation(
    gsapCommitMutation ?? noopCommit,
    trackGsapSaveFailure,
    showToast,
  );

  const commitMutation = useCallback(
    async (mutation: Record<string, unknown>, options: { label: string; softReload?: boolean }) => {
      if (!domEditSelection) return;
      // Return (await) the safe-commit chain so consumers that `await
      // session.commitMutation(...)` (gesture recording, enable-keyframes) run
      // their post-actions only after the server save has settled.
      await safeGsapCommit(domEditSelection, mutation, options);
    },
    [domEditSelection, safeGsapCommit],
  );

  // Unroll all computed (helper/loop) tweens in the active timeline into literal
  // tweens, so the clicked keyframe becomes directly editable. Visual no-op.
  const handleUnroll = useCallback(() => {
    void commitMutation(
      { type: "unroll-timeline" },
      { label: "Unroll to literal tweens", softReload: true },
    );
  }, [commitMutation]);

  return {
    handleGsapAwarePathOffsetCommit,
    handleGsapAwareBoxSizeCommit,
    handleGsapAwareRotationCommit,
    commitAnimatedProperty,
    handleSetArcPath,
    handleUpdateArcSegment,
    handleUnroll,
    commitMutation,
  };
}
