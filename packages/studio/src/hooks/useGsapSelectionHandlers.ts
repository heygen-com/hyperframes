import { useCallback, useRef } from "react";
import type { GsapAnimation } from "@hyperframes/core/gsap-parser";
import type { DomEditSelection } from "../components/editor/domEditing";
import { usePlayerStore } from "../player";
import { computeCurrentPercentage } from "./gsapDragCommit";
import { trackStudioSaveFailure } from "../utils/studioSaveDiagnostics";
import { trackStudioEvent } from "../utils/studioTelemetry";

/**
 * Thin useCallback wrappers that guard on `domEditSelection` before
 * delegating to the underlying GSAP script-commit functions. Extracted
 * from useDomEditSession to keep that file under the 600-line limit.
 */
// fallow-ignore-next-line complexity
export function useGsapSelectionHandlers({
  domEditSelection,
  updateGsapProperty,
  updateGsapMeta,
  deleteGsapAnimation,
  deleteAllForSelector,
  addGsapAnimation,
  addGsapProperty,
  removeGsapProperty,
  updateGsapFromProperty,
  addGsapFromProperty,
  removeGsapFromProperty,
  addKeyframe,
  addKeyframeBatch,
  removeKeyframe,
  moveKeyframe,
  resizeKeyframedTween,
  convertToKeyframes,
  removeAllKeyframes,
  handleDomManualEditsReset,
  selectedGsapAnimations,
}: {
  domEditSelection: DomEditSelection | null;
  updateGsapProperty: (
    sel: DomEditSelection,
    animId: string,
    prop: string,
    value: number | string,
  ) => void;
  updateGsapMeta: (
    sel: DomEditSelection,
    animId: string,
    updates: { duration?: number; ease?: string; position?: number },
  ) => void;
  deleteGsapAnimation: (sel: DomEditSelection, animId: string) => void;
  deleteAllForSelector: (sel: DomEditSelection, targetSelector: string) => void;
  addGsapAnimation: (
    sel: DomEditSelection,
    method: "to" | "from" | "set" | "fromTo",
    time: number,
  ) => Promise<void>;
  addGsapProperty: (sel: DomEditSelection, animId: string, prop: string) => void;
  removeGsapProperty: (sel: DomEditSelection, animId: string, prop: string) => void;
  updateGsapFromProperty: (
    sel: DomEditSelection,
    animId: string,
    prop: string,
    value: number | string,
  ) => void;
  addGsapFromProperty: (sel: DomEditSelection, animId: string, prop: string) => void;
  removeGsapFromProperty: (sel: DomEditSelection, animId: string, prop: string) => void;
  addKeyframe: (
    sel: DomEditSelection,
    animId: string,
    percentage: number,
    property: string,
    value: number | string,
  ) => void;
  addKeyframeBatch: (
    sel: DomEditSelection,
    animId: string,
    percentage: number,
    properties: Record<string, number | string>,
  ) => Promise<void>;
  removeKeyframe: (sel: DomEditSelection, animId: string, percentage: number) => void;
  moveKeyframe: (
    sel: DomEditSelection,
    animId: string,
    fromPercentage: number,
    toPercentage: number,
  ) => void;
  resizeKeyframedTween: (
    sel: DomEditSelection,
    animId: string,
    position: number,
    duration: number,
    pctRemap: Array<{ from: number; to: number }>,
  ) => void;
  convertToKeyframes: (
    sel: DomEditSelection,
    animId: string,
    resolvedFromValues?: Record<string, number | string>,
    duration?: number,
  ) => Promise<void>;
  removeAllKeyframes: (sel: DomEditSelection, animId: string) => void;

  handleDomManualEditsReset: (sel: DomEditSelection) => void;
  selectedGsapAnimations: GsapAnimation[];
}) {
  const lastSelectionRef = useRef<DomEditSelection | null>(null);
  if (domEditSelection) lastSelectionRef.current = domEditSelection;

  const trackGsapHandlerFailure = useCallback(
    (error: unknown, selection: DomEditSelection, mutationType: string, label: string) => {
      trackStudioSaveFailure({
        source: "gsap_commit",
        error,
        filePath: selection.sourceFile ?? undefined,
        mutationType,
        label,
        targetId: selection.id,
        targetSelector: selection.selector,
        targetSourceFile: selection.sourceFile,
      });
    },
    [],
  );

  const handleGsapUpdateProperty = useCallback(
    (animId: string, prop: string, value: number | string) => {
      if (!domEditSelection) return;
      updateGsapProperty(domEditSelection, animId, prop, value);
    },
    [domEditSelection, updateGsapProperty],
  );

  const handleGsapUpdateMeta = useCallback(
    (
      animId: string,
      updates: { duration?: number; ease?: string; position?: number },
      selectionOverride?: DomEditSelection | null,
    ) => {
      const sel = selectionOverride ?? domEditSelection ?? lastSelectionRef.current;
      if (!sel) return;
      updateGsapMeta(sel, animId, updates);
    },
    [domEditSelection, updateGsapMeta],
  );

  const handleGsapDeleteAnimation = useCallback(
    (animId: string) => {
      const sel = domEditSelection ?? lastSelectionRef.current;
      if (!sel) return;
      deleteGsapAnimation(sel, animId);
    },
    [domEditSelection, deleteGsapAnimation],
  );

  const handleGsapDeleteAllForElement = useCallback(
    (targetSelector: string) => {
      const sel = domEditSelection ?? lastSelectionRef.current;
      if (!sel) return;
      trackStudioEvent("keyframe", { action: "delete_all" });
      deleteAllForSelector(sel, targetSelector);
    },
    [domEditSelection, deleteAllForSelector],
  );

  const handleGsapAddAnimation = useCallback(
    (method: "to" | "from" | "set" | "fromTo") => {
      if (!domEditSelection) return;
      void addGsapAnimation(domEditSelection, method, usePlayerStore.getState().currentTime).catch(
        (error) => {
          trackGsapHandlerFailure(error, domEditSelection, "add", `Add GSAP ${method} animation`);
        },
      );
      if (domEditSelection.element.hasAttribute("data-hf-studio-path-offset")) {
        handleDomManualEditsReset(domEditSelection);
      }
    },
    [domEditSelection, addGsapAnimation, handleDomManualEditsReset, trackGsapHandlerFailure],
  );

  const handleGsapAddProperty = useCallback(
    (animId: string, prop: string) => {
      if (!domEditSelection) return;
      addGsapProperty(domEditSelection, animId, prop);
    },
    [domEditSelection, addGsapProperty],
  );

  const handleGsapRemoveProperty = useCallback(
    (animId: string, prop: string) => {
      if (!domEditSelection) return;
      removeGsapProperty(domEditSelection, animId, prop);
    },
    [domEditSelection, removeGsapProperty],
  );

  const handleGsapUpdateFromProperty = useCallback(
    (animId: string, prop: string, value: number | string) => {
      if (!domEditSelection) return;
      updateGsapFromProperty(domEditSelection, animId, prop, value);
    },
    [domEditSelection, updateGsapFromProperty],
  );

  const handleGsapAddFromProperty = useCallback(
    (animId: string, prop: string) => {
      if (!domEditSelection) return;
      addGsapFromProperty(domEditSelection, animId, prop);
    },
    [domEditSelection, addGsapFromProperty],
  );

  const handleGsapRemoveFromProperty = useCallback(
    (animId: string, prop: string) => {
      if (!domEditSelection) return;
      removeGsapFromProperty(domEditSelection, animId, prop);
    },
    [domEditSelection, removeGsapFromProperty],
  );

  const handleGsapAddKeyframe = useCallback(
    (
      animId: string,
      percentage: number,
      property: string,
      value: number | string,
      selectionOverride?: DomEditSelection | null,
    ) => {
      const sel = selectionOverride ?? domEditSelection ?? lastSelectionRef.current;
      if (!sel) return;
      trackStudioEvent("keyframe", { action: "add", property });
      addKeyframe(sel, animId, percentage, property, value);
    },
    [domEditSelection, addKeyframe],
  );

  const handleGsapAddKeyframeBatch = useCallback(
    (animId: string, percentage: number, properties: Record<string, number | string>) => {
      if (!domEditSelection) return Promise.resolve();
      return addKeyframeBatch(domEditSelection, animId, percentage, properties).catch((error) => {
        trackGsapHandlerFailure(error, domEditSelection, "add-keyframe", "Add keyframe");
      });
    },
    [domEditSelection, addKeyframeBatch, trackGsapHandlerFailure],
  );
  const handleGsapRemoveKeyframe = useCallback(
    (animId: string, percentage: number, selectionOverride?: DomEditSelection | null) => {
      const sel = selectionOverride ?? domEditSelection ?? lastSelectionRef.current;
      if (!sel) return;
      trackStudioEvent("keyframe", { action: "remove" });
      removeKeyframe(sel, animId, percentage);
    },
    [domEditSelection, removeKeyframe],
  );

  const handleGsapMoveKeyframeToPlayhead = useCallback(
    (animId: string, fromPercentage: number, selectionOverride?: DomEditSelection | null) => {
      const sel = selectionOverride ?? domEditSelection ?? lastSelectionRef.current;
      if (!sel) return;
      // Retime the keyframe to the playhead, preserving its value + ease. The
      // playhead's tween-relative percentage is the move target.
      const anim = selectedGsapAnimations.find((a) => a.id === animId);
      const toPercentage = computeCurrentPercentage(sel, anim);
      trackStudioEvent("keyframe", { action: "move_to_playhead" });
      moveKeyframe(sel, animId, fromPercentage, toPercentage);
    },
    [domEditSelection, selectedGsapAnimations, moveKeyframe],
  );

  const handleGsapMoveKeyframe = useCallback(
    (
      animId: string,
      fromPercentage: number,
      toPercentage: number,
      selectionOverride?: DomEditSelection | null,
    ) => {
      const sel = selectionOverride ?? domEditSelection ?? lastSelectionRef.current;
      if (!sel) return;
      // Atomic retime: preserves the keyframe's value + per-keyframe ease. Both
      // percentages are tween-relative (the drag handler converts the drop
      // position before calling). No optimistic runtime hold — the soft-reload
      // re-keys the diamond from source.
      trackStudioEvent("keyframe", { action: "retime" });
      moveKeyframe(sel, animId, fromPercentage, toPercentage);
    },
    [domEditSelection, moveKeyframe],
  );

  const handleGsapResizeKeyframedTween = useCallback(
    (
      animId: string,
      position: number,
      duration: number,
      pctRemap: Array<{ from: number; to: number }>,
      selectionOverride?: DomEditSelection | null,
    ) => {
      const sel = selectionOverride ?? domEditSelection ?? lastSelectionRef.current;
      if (!sel) return;
      // Boundary drag-to-retime: grows/shifts the tween window + re-keys keyframes
      // in place. Distinct telemetry action so resize is separable from in-window move.
      trackStudioEvent("keyframe", { action: "retime_resize" });
      resizeKeyframedTween(sel, animId, position, duration, pctRemap);
    },
    [domEditSelection, resizeKeyframedTween],
  );

  const handleGsapConvertToKeyframes = useCallback(
    (animId: string, resolvedFromValues?: Record<string, number | string>, duration?: number) => {
      if (!domEditSelection) return Promise.resolve();
      return convertToKeyframes(domEditSelection, animId, resolvedFromValues, duration).catch(
        (error) => {
          trackGsapHandlerFailure(
            error,
            domEditSelection,
            "convert-to-keyframes",
            "Convert to keyframes",
          );
        },
      );
    },
    [domEditSelection, convertToKeyframes, trackGsapHandlerFailure],
  );

  const handleGsapRemoveAllKeyframes = useCallback(
    (animId: string) => {
      if (!domEditSelection) return;
      removeAllKeyframes(domEditSelection, animId);
    },
    [domEditSelection, removeAllKeyframes],
  );

  const handleResetSelectedElementKeyframes = useCallback((): boolean => {
    if (!domEditSelection) return false;
    const withKeyframes = selectedGsapAnimations.find((a) => a.keyframes);
    if (!withKeyframes) return false;
    removeAllKeyframes(domEditSelection, withKeyframes.id);
    return true;
  }, [domEditSelection, selectedGsapAnimations, removeAllKeyframes]);

  return {
    handleGsapUpdateProperty,
    handleGsapUpdateMeta,
    handleGsapDeleteAnimation,
    handleGsapDeleteAllForElement,
    handleGsapAddAnimation,
    handleGsapAddProperty,
    handleGsapRemoveProperty,
    handleGsapUpdateFromProperty,
    handleGsapAddFromProperty,
    handleGsapRemoveFromProperty,
    handleGsapAddKeyframe,
    handleGsapAddKeyframeBatch,
    handleGsapRemoveKeyframe,
    handleGsapMoveKeyframeToPlayhead,
    handleGsapMoveKeyframe,
    handleGsapResizeKeyframedTween,
    handleGsapConvertToKeyframes,
    handleGsapRemoveAllKeyframes,
    handleResetSelectedElementKeyframes,
  };
}
