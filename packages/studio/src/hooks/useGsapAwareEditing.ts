import { useGsapAwareGroupMove } from "./useGsapAwareGroupMove";
import { observeGsapGesture } from "./gsapGestureOutcome";
import type { DomEditPersistOutcome } from "./domEditCommitTypes";
/**
 * GSAP-aware move/resize/rotation wrappers that intercept geometry commits
 * for animated elements and route them through script mutation instead of
 * CSS patching. Also exposes the animated-property commit, arc-path ops,
 * and the thin `commitMutation` facade.
 *
 * Extracted from useDomEditSession to isolate the GSAP intercept routing
 * from the rest of the editing orchestration.
 */
import type { RotationCommit } from "../components/editor/rotationDraft";
import { useCallback } from "react";
import type { GsapAnimation } from "@hyperframes/core/gsap-parser";
import type { DomEditSelection } from "../components/editor/domEditingTypes";
import { tryGsapDragIntercept, tryGsapRotationIntercept } from "./gsapRuntimeBridge";
import { tryGsapResizeIntercept } from "./gsapResizeIntercept";
import { computeDraggedGsapPosition } from "./draggedGsapPosition";
import { readGsapPositionFromIframe } from "./gsapPositionDetection";
import { selectorFromSelection } from "./gsapShared";
import { useAnimatedPropertyCommit } from "./useAnimatedPropertyCommit";
import {
  useGsapSaveFailureTelemetry,
  useSafeGsapCommitMutation,
} from "./useSafeGsapCommitMutation";
import type { CommitMutation, CommitMutationOptions } from "./gsapScriptCommitTypes";
import { setElementGsapPosition } from "../utils/elementGsap";
import { logResize, logResizeSettle } from "../utils/resizeDebug";
import type { MoveCommitOptions } from "../components/editor/domEditOverlayGestures";
import { runGestureTransaction } from "./gestureTransaction";
import {
  gsapWritesBox,
  gsapWritesPosition,
  gsapWritesRotation,
  hasNonHoldTweenForElement,
  POSITION_CHANNELS,
} from "./gsapRuntimeKeyframes";
import { assertGsapEditPersisted, saveMove } from "./gsapEditOutcome";
import type { GsapAnimationFetchOptions } from "./useGsapAnimationFetchFallback";
import { type ElementOffsetStagerDeps } from "./elementOffsetStager";
import {
  prepareCropResize,
  saveCropResize,
  writeSizeWithCrop,
} from "../components/editor/cropResize";

export interface UseGsapAwareEditingParams {
  domEditSelection: DomEditSelection | null;
  selectedGsapAnimations: GsapAnimation[];
  gsapCommitMutation: CommitMutation | null;
  previewIframeRef: React.RefObject<HTMLIFrameElement | null>;
  showToast: (message: string, tone?: "error" | "info") => void;
  bumpGsapCache: () => void;
  makeFetchFallback: (
    selection: DomEditSelection,
    options?: GsapAnimationFetchOptions,
  ) => () => Promise<GsapAnimation[]>;
  trackGsapInteractionFailure: (
    error: unknown,
    selection: DomEditSelection | null,
    mutationType: string,
    label: string,
  ) => void;
  // DOM fallbacks (from useDomEditCommits)
  stageElementPositionOffset: (
    selection: DomEditSelection,
    next: { x: number; y: number },
    plainTranslate: boolean,
    coalesceKey?: string,
  ) => { save: () => Promise<DomEditPersistOutcome | undefined>; rollback: () => void };
  handleDomRotationCommit: (
    selection: DomEditSelection,
    next: RotationCommit,
  ) => Promise<DomEditPersistOutcome | undefined>;
  handleDomBoxSizeCommit: (
    selection: DomEditSelection,
    next: { width: number; height: number },
    offset?: { x: number; y: number },
    restore?: () => void,
    undoKey?: string,
  ) => Promise<DomEditPersistOutcome | undefined>;
  commitPositionPatchToHtml: ElementOffsetStagerDeps["commitPositionPatchToHtml"];
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
  stageElementPositionOffset,
  handleDomBoxSizeCommit,
  handleDomRotationCommit,
  commitPositionPatchToHtml,
  addGsapAnimation,
  convertToKeyframes,
  setArcPath,
  updateArcSegment,
}: UseGsapAwareEditingParams) {
  // ── GSAP-aware geometry commits ──

  const getGsapAnimationsForSelection = useCallback(
    (selection: DomEditSelection): GsapAnimation[] | Promise<GsapAnimation[]> => {
      if (domEditSelection?.element === selection.element) return selectedGsapAnimations;
      return makeFetchFallback(selection, { failOnFetchError: true })();
    },
    [domEditSelection, selectedGsapAnimations, makeFetchFallback],
  );

  const handleGsapAwarePathOffsetCommit = useCallback(
    async (
      selection: DomEditSelection,
      next: { x: number; y: number },
      modifiers?: MoveCommitOptions,
    ) => {
      const writes = observeGsapGesture(gsapCommitMutation);
      if (modifiers?.plainTranslate ?? !gsapWritesPosition(selection.element)) {
        const result = await stageElementPositionOffset(selection, next, true).save();
        return writes.finish(result?.changed === true);
      }
      if (writes.commit) {
        try {
          const ownedAnimations = getGsapAnimationsForSelection(selection);
          const targetAnimations = Array.isArray(ownedAnimations)
            ? ownedAnimations
            : await ownedAnimations;
          const outcome = await tryGsapDragIntercept(
            selection,
            next,
            targetAnimations,
            previewIframeRef.current,
            writes.commit,
            makeFetchFallback(selection),
            modifiers,
          );
          await saveMove(outcome, async () => {
            const result = await stageElementPositionOffset(selection, next, false).save();
            writes.recordDomResult(result);
          });
          return writes.finish();
        } catch (error) {
          trackGsapInteractionFailure(error, selection, "drag", "Move animated layer");
          throw error;
        }
      }
    },
    [
      gsapCommitMutation,
      previewIframeRef,
      makeFetchFallback,
      trackGsapInteractionFailure,
      getGsapAnimationsForSelection,
      stageElementPositionOffset,
    ],
  );

  const handleGsapAwareGroupPathOffsetCommit = useGsapAwareGroupMove({
    gsapCommitMutation,
    previewIframeRef,
    makeFetchFallback,
    trackGsapInteractionFailure,
    stageElementPositionOffset,
    showToast,
  });

  const handleGsapAwareBoxSizeCommit = useCallback(
    async (
      selection: DomEditSelection,
      next: { width: number; height: number },
      offset?: { x: number; y: number },
      restore: () => void = () => undefined,
    ) => {
      const writes = observeGsapGesture(gsapCommitMutation);
      if (!gsapWritesBox(selection.element)) {
        const result = await handleDomBoxSizeCommit(selection, next, offset, restore);
        return writes.finish(result?.changed === true);
      }
      let targetAnimations: GsapAnimation[];
      try {
        const ownedAnimations = getGsapAnimationsForSelection(selection);
        targetAnimations = Array.isArray(ownedAnimations) ? ownedAnimations : await ownedAnimations;
      } catch (error) {
        restore();
        trackGsapInteractionFailure(error, selection, "resize", "Resize animated layer");
        throw error;
      }
      const scaleRoute = targetAnimations.some((anim) => anim.propertyGroup === "scale");
      const selector = selectorFromSelection(selection);
      const hasLivePositionTween = selector
        ? hasNonHoldTweenForElement(
            previewIframeRef.current,
            selector,
            undefined,
            POSITION_CHANNELS,
          )
        : false;
      logResize("commit-route", {
        next,
        offset: offset ?? null,
        scaleRoute,
        animCount: targetAnimations.length,
        animGroups: targetAnimations.map((a) => `${a.propertyGroup}:${a.method}`),
      });
      let anchorMove: ReturnType<typeof stageElementPositionOffset> | null = null;
      const stageCrop = prepareCropResize(selection.element);
      let cropUndoKey: string | null = null;
      const saveResizeAnchor = async (
        ownsDragOffset: boolean,
        commitMutation: CommitMutation,
        coalesceKey: string,
      ) => {
        if (offset && !ownsDragOffset) {
          const dragOutcome = await tryGsapDragIntercept(
            selection,
            offset,
            targetAnimations,
            previewIframeRef.current,
            commitMutation,
            makeFetchFallback(selection),
          );
          // Saved after the size, under its undo key, so the two are one step.
          await saveMove(dragOutcome, async () => {
            const plain = !gsapWritesPosition(selection.element);
            anchorMove = stageElementPositionOffset(selection, offset, plain, coalesceKey);
          });
        }
      };
      await runGestureTransaction({
        element: selection.element,
        label: "Resize layer",
        settle: () => {
          // Scale resize settles its center-scale residual after the scale commit
          // renders. Width/height can settle its anchored position immediately.
          if (!offset || scaleRoute || !selector) return;
          const gsapPos = readGsapPositionFromIframe(previewIframeRef.current, selector) ?? {
            x: 0,
            y: 0,
          };
          const { newX, newY } = computeDraggedGsapPosition(selection.element, offset, gsapPos);
          logResize("sync-settle", { gsapPos, offset, newX, newY });
          setElementGsapPosition(selection.element, newX, newY);
        },
        persist: async (commit, coalesceKey) => {
          if (writes.commit) {
            const commitMutation = commit(writes.commit);
            try {
              const outcome = await tryGsapResizeIntercept(
                selection,
                next,
                targetAnimations,
                previewIframeRef.current,
                commitMutation,
                makeFetchFallback(selection),
              );
              assertGsapEditPersisted(outcome);
              // Saved before the buffered GSAP writes, so their reload stays the gesture's last render.
              if (outcome.status === "element-size") {
                const result = await handleDomBoxSizeCommit(
                  selection,
                  next,
                  undefined,
                  undefined,
                  coalesceKey,
                );
                writes.recordDomResult(result);
              } else cropUndoKey = coalesceKey;
              // What the resize did, not what its tweens suggest: a scale hold still commits a size.
              const ownsDragOffset =
                outcome.status === "persisted" && outcome.ownsDragOffset === true;
              logResize("intercept-handled", {
                scaleRoute,
                ownsDragOffset,
                willForwardOffset: !!(offset && !ownsDragOffset),
              });
              // A resize that moved the element itself has already written
              // where it landed. Everything else leaves the anchor to the drag.
              await saveResizeAnchor(ownsDragOffset, commitMutation, coalesceKey);
              logResizeSettle(selection.element, ownsDragOffset ? "gsap-scale" : "gsap-size");
              return;
            } catch (error) {
              trackGsapInteractionFailure(error, selection, "resize", "Resize animated layer");
              throw error;
            }
          }
          throw new Error("Resize of a GSAP-owned box has no GSAP writer");
        },
        afterBufferedCommitsSaved: async () => {
          const anchorResult = await anchorMove?.save();
          writes.recordDomResult(anchorResult);
          // Only now is the size live for every caller, drag or not.
          if (cropUndoKey) {
            const cropResult = await saveCropResize(
              stageCrop,
              selection,
              commitPositionPatchToHtml,
              cropUndoKey,
            );
            writes.recordDomResult(cropResult);
          }
        },
        restore: () => {
          anchorMove?.rollback();
          restore();
        },
        skipPixelAssert: hasLivePositionTween,
      });
      return writes.finish();
    },
    [
      handleDomBoxSizeCommit,
      commitPositionPatchToHtml,
      stageElementPositionOffset,
      gsapCommitMutation,
      previewIframeRef,
      makeFetchFallback,
      trackGsapInteractionFailure,
      getGsapAnimationsForSelection,
    ],
  );

  const handleGsapAwareRotationCommit = useCallback(
    async (selection: DomEditSelection, next: RotationCommit) => {
      const writes = observeGsapGesture(gsapCommitMutation);
      if (next.plain || !gsapWritesRotation(selection.element)) {
        const result = await handleDomRotationCommit(selection, next);
        return writes.finish(result?.changed === true);
      }
      if (writes.commit) {
        try {
          const targetAnimations = await getGsapAnimationsForSelection(selection);
          // A keyframe or a tl.set; a computed source rejects, so the gesture restores its draft.
          const outcome = await tryGsapRotationIntercept(
            selection,
            next.angle,
            targetAnimations,
            previewIframeRef.current,
            writes.commit,
            makeFetchFallback(selection),
          );
          assertGsapEditPersisted(outcome);
          return writes.finish();
        } catch (error) {
          trackGsapInteractionFailure(error, selection, "rotation", "Rotate animated layer");
          throw error;
        }
      }
    },
    [
      gsapCommitMutation,
      previewIframeRef,
      makeFetchFallback,
      trackGsapInteractionFailure,
      getGsapAnimationsForSelection,
      handleDomRotationCommit,
    ],
  );

  // ── Animated property commit ──

  const { commitAnimatedProperties: commitAnimatedPropertiesRaw } = useAnimatedPropertyCommit({
    selectedGsapAnimations,
    gsapCommitMutation,
    addGsapAnimation: (sel, method, time) => addGsapAnimation(sel, method, time),
    convertToKeyframes: (sel, animId) => convertToKeyframes(sel, animId),
    previewIframeRef,
    bumpGsapCache,
  });

  const commitAnimatedProperties = useCallback(
    async (selection: DomEditSelection, properties: Record<string, number | string>) => {
      try {
        await writeSizeWithCrop(
          selection,
          properties,
          gsapCommitMutation,
          commitPositionPatchToHtml,
          (keyed) => commitAnimatedPropertiesRaw(selection, properties, keyed),
        );
      } catch (error) {
        trackGsapInteractionFailure(error, selection, "property", "Edit animated property");
        throw error;
      }
    },
    [
      commitAnimatedPropertiesRaw,
      commitPositionPatchToHtml,
      gsapCommitMutation,
      trackGsapInteractionFailure,
    ],
  );

  const commitAnimatedProperty = useCallback(
    (selection: DomEditSelection, property: string, value: number | string) =>
      commitAnimatedProperties(selection, { [property]: value }),
    [commitAnimatedProperties],
  );

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
    async (mutation: Record<string, unknown>, options: CommitMutationOptions) => {
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
    getGsapAnimationsForSelection,
    handleGsapAwarePathOffsetCommit,
    handleGsapAwareGroupPathOffsetCommit,
    handleGsapAwareBoxSizeCommit,
    handleGsapAwareRotationCommit,
    commitAnimatedProperty,
    commitAnimatedProperties,
    handleSetArcPath,
    handleUpdateArcSegment,
    handleUnroll,
    commitMutation,
  };
}
