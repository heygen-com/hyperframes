import { useRef, type RefObject } from "react";
import { useDomEditActionsContextOptional } from "../../contexts/DomEditContext";
import { useInlineTextEdit } from "../../hooks/useInlineTextEdit";
import { usePlayerStore } from "../../player/store/playerStore";
import { canEditTextInline, isDoublePress, type PressMark } from "./domEditInlineText";
import type { DomEditSelection } from "./domEditingTypes";

/**
 * The canvas' side of editing text where it sits.
 *
 * Holds the session, decides which presses open one, and knows the two things
 * the canvas has to do differently while one is open: stand aside so the caret
 * underneath can be reached, and stop taking focus back.
 *
 * The actions context is read here rather than threaded through the overlay's
 * props, the same way the agent surfaces in that overlay read it, and it is
 * absent in standalone player mounts, which have no project to edit.
 */
export function useInlineTextEditing(selectionRef: RefObject<DomEditSelection | null>): {
  editing: boolean;
  /** Open an edit when this press pairs with the last one. */
  startFromPress: (event: { clientX: number; clientY: number }) => boolean;
} {
  const actions = useDomEditActionsContextOptional();
  const inlineText = useInlineTextEdit({
    onCommit: (text) => void actions?.handleDomTextCommit(text),
    onPause: () => usePlayerStore.getState().setIsPlaying(false),
  });
  const lastPressRef = useRef<PressMark | null>(null);

  return {
    editing: inlineText.session !== null,
    startFromPress: (event) => {
      const press = { x: event.clientX, y: event.clientY, at: Date.now() };
      const paired = isDoublePress(lastPressRef.current, press);
      lastPressRef.current = press;

      const target = selectionRef.current;
      if (!paired || inlineText.session || !canEditTextInline(target)) return false;
      return inlineText.start(target!.element);
    },
  };
}
