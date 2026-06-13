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
import type { GsapAnimation } from "@hyperframes/core/gsap-parser";
import type { DomEditSelection } from "../components/editor/domEditingTypes";
import { STUDIO_GSAP_DRAG_INTERCEPT_ENABLED } from "../components/editor/manualEditingAvailability";
import { GSAP_CSS_FALLBACK_BLOCKED_MESSAGE } from "./useDomGeometryCommits";
import {
  tryGsapDragIntercept,
  tryGsapResizeIntercept,
  tryGsapRotationIntercept,
} from "./gsapRuntimeBridge";
import { useAnimatedPropertyCommit } from "./useAnimatedPropertyCommit";
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
  handleDomPathOffsetCommit: (
    selection: DomEditSelection,
    next: { x: number; y: number },
  ) => Promise<void>;
  handleDomBoxSizeCommit: (
    selection: DomEditSelection,
    next: { width: number; height: number },
  ) => Promise<void>;
  handleDomRotationCommit: (selection: DomEditSelection, next: { angle: number }) => Promise<void>;
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
  handleDomPathOffsetCommit,
  handleDomBoxSizeCommit,
  handleDomRotationCommit,
  addGsapAnimation,
  convertToKeyframes,
  setArcPath,
  updateArcSegment,
}: UseGsapAwareEditingParams) {
  // ── GSAP-aware geometry commits ──

  const handleGsapAwarePathOffsetCommit = useCallback(
    async (selection: DomEditSelection, next: { x: number; y: number }) => {
      const hasGsapAnims = selectedGsapAnimations.length > 0;
      if (hasGsapAnims && !STUDIO_GSAP_DRAG_INTERCEPT_ENABLED) {
        showToast(GSAP_CSS_FALLBACK_BLOCKED_MESSAGE, "error");
        throw new Error(GSAP_CSS_FALLBACK_BLOCKED_MESSAGE);
      }
      if (STUDIO_GSAP_DRAG_INTERCEPT_ENABLED && gsapCommitMutation) {
        try {
          const handled = await tryGsapDragIntercept(
            selection,
            next,
            selectedGsapAnimations,
            previewIframeRef.current,
            gsapCommitMutation,
            makeFetchFallback(selection),
          );
          if (handled) return;
        } catch (error) {
          trackGsapInteractionFailure(error, selection, "drag", "Move animated layer");
          throw error;
        }
      }
      return handleDomPathOffsetCommit(selection, next);
    },
    [
      handleDomPathOffsetCommit,
      selectedGsapAnimations,
      gsapCommitMutation,
      previewIframeRef,
      makeFetchFallback,
      trackGsapInteractionFailure,
      showToast,
    ],
  );

  const handleGsapAwareBoxSizeCommit = useCallback(
    async (selection: DomEditSelection, next: { width: number; height: number }) => {
      if (STUDIO_GSAP_DRAG_INTERCEPT_ENABLED && gsapCommitMutation) {
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
      if (STUDIO_GSAP_DRAG_INTERCEPT_ENABLED && gsapCommitMutation) {
        try {
          const handled = await tryGsapRotationIntercept(
            selection,
            next.angle,
            selectedGsapAnimations,
            previewIframeRef.current,
            gsapCommitMutation,
            makeFetchFallback(selection),
          );
          if (handled) return;
        } catch (error) {
          trackGsapInteractionFailure(error, selection, "rotation", "Rotate animated layer");
          throw error;
        }
      }
      return handleDomRotationCommit(selection, next);
    },
    [
      handleDomRotationCommit,
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

  const commitMutation = useCallback(
    async (mutation: Record<string, unknown>, options: { label: string; softReload?: boolean }) => {
      if (!domEditSelection) return;
      await gsapCommitMutation?.(domEditSelection, mutation, options);
    },
    [domEditSelection, gsapCommitMutation],
  );

  return {
    handleGsapAwarePathOffsetCommit,
    handleGsapAwareBoxSizeCommit,
    handleGsapAwareRotationCommit,
    commitAnimatedProperty,
    handleSetArcPath,
    handleUpdateArcSegment,
    commitMutation,
  };
}
