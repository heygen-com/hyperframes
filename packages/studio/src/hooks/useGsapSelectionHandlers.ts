import { useCallback, useRef } from "react";
import type { DomEditSelection } from "../components/editor/domEditing";
import { usePlayerStore } from "../player";
import { trackStudioSaveFailure } from "../utils/studioSaveDiagnostics";

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
  convertToKeyframes: (
    sel: DomEditSelection,
    animId: string,
    resolvedFromValues?: Record<string, number | string>,
  ) => Promise<void>;
  removeAllKeyframes: (sel: DomEditSelection, animId: string) => void;

  handleDomManualEditsReset: (sel: DomEditSelection) => void;
  selectedGsapAnimations: { id: string; keyframes?: unknown }[];
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
    (animId: string, updates: { duration?: number; ease?: string; position?: number }) => {
      if (!domEditSelection) return;
      updateGsapMeta(domEditSelection, animId, updates);
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
    (animId: string, percentage: number, property: string, value: number | string) => {
      if (!domEditSelection) return;
      addKeyframe(domEditSelection, animId, percentage, property, value);
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
    (animId: string, percentage: number) => {
      if (!domEditSelection) return;
      removeKeyframe(domEditSelection, animId, percentage);
    },
    [domEditSelection, removeKeyframe],
  );

  const handleGsapConvertToKeyframes = useCallback(
    (animId: string, resolvedFromValues?: Record<string, number | string>) => {
      if (!domEditSelection) return Promise.resolve();
      return convertToKeyframes(domEditSelection, animId, resolvedFromValues).catch((error) => {
        trackGsapHandlerFailure(
          error,
          domEditSelection,
          "convert-to-keyframes",
          "Convert to keyframes",
        );
      });
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
    handleGsapConvertToKeyframes,
    handleGsapRemoveAllKeyframes,
    handleResetSelectedElementKeyframes,
  };
}
