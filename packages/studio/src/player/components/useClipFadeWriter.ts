import { useCallback, useMemo } from "react";
import { useDomEditActionsContextOptional } from "../../contexts/DomEditContext";
import { usePlayerStore, type TimelineElement } from "../store/playerStore";
import {
  resolveClipFadeBinding,
  type ClipFadeBinding,
  type FadeAttributeWriter,
} from "./clipFadeBinding";
import type { UseAutomationLanesResult } from "./useAutomationLanes";

/**
 * The visual fade's write path: one attribute on the selected clip.
 *
 * Same two-speed shape the automation lane uses — a preview-only write on every
 * pointer move so the composition follows the drag without reloading, and one
 * persisted write on release. Both carry the gesture's coalesce key so a whole
 * drag collapses into a single undo step.
 *
 * Undefined outside an edit session: the player runs without one, and there the
 * grips render read-only.
 */
function useClipFadeWriter(): FadeAttributeWriter | undefined {
  const domEdit = useDomEditActionsContextOptional();
  return useMemo<FadeAttributeWriter | undefined>(() => {
    if (!domEdit) return undefined;
    return (attr, value, persist, coalesce) => {
      if (persist) {
        void domEdit.handleDomAttributeQuietCommit(attr, value, coalesce);
        return;
      }
      void domEdit.handleDomAttributeLiveCommit(attr, value, undefined, {
        coalesce,
        previewOnly: true,
      });
    };
  }, [domEdit]);
}

/**
 * Bind a clip's fade grips, whichever storage its medium uses. Takes the
 * timeline's own automation binder rather than making a second one, so an audio
 * fade and a hand-dragged breakpoint share one gesture-key sequence and land in
 * the same undo entry.
 */
export function useClipFadeBinder(
  automationLanes: UseAutomationLanesResult,
): (element: TimelineElement, isSelected: boolean) => ClipFadeBinding | undefined {
  const writeAttribute = useClipFadeWriter();
  const updateElement = usePlayerStore((s) => s.updateElement);
  return useCallback(
    (element, isSelected) =>
      resolveClipFadeBinding(element, {
        bindAutomation: (target) => automationLanes.bind(target, isSelected),
        writeAttribute,
        isSelected: () => isSelected,
        updateElement,
      }),
    [automationLanes, writeAttribute, updateElement],
  );
}
