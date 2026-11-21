import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import { InlineTextCaret } from "./InlineTextCaret";
import { InlineTextToolbar } from "./InlineTextToolbar";
import { useDomEditActionsContextOptional } from "../../contexts/DomEditContext";
import { useStudioShellContextOptional } from "../../contexts/StudioContext";
import { textEditNotSaved } from "../../hooks/useDomEditTextCommits";
import { useInlineTextEdit } from "../../hooks/useInlineTextEdit";
import { usePlayerStore } from "../../player/store/playerStore";
import { getPreviewTargetFromPointer } from "../../utils/studioPreviewHelpers";
import { previewFrameOpaque } from "../../player/lib/previewChannel";
import {
  canEditElementTextInline,
  canEditSealedTextInline,
  canOpenTextInline,
  isDoublePress,
  type PressMark,
} from "./domEditInlineText";
import type { DomEditSelection } from "./domEditingTypes";

type KeyChord = Pick<KeyboardEvent, "key" | "shiftKey" | "ctrlKey" | "metaKey" | "altKey">;

const isPlainEnter = (event: KeyChord) =>
  event.key === "Enter" && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey;

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
export function useInlineTextEditing(
  selectionRef: RefObject<DomEditSelection | null>,
  { enterFromWindow = false }: { enterFromWindow?: boolean } = {},
): {
  editing: boolean;
  /** Open an edit when this press pairs with the last one. */
  startFromPress: (event: { clientX: number; clientY: number }) => boolean;
  /** Handle a key on the canvas. Returns true when it opened an edit. */
  handleKeyDown: (event: KeyChord) => boolean;
  /**
   * The styling controls for the current selection, for the caller to render.
   *
   * Handed back rather than mounted somewhere central because it belongs to the
   * session this hook owns, and appears and disappears with it.
   */
  toolbar: ReactNode;
} {
  const actions = useDomEditActionsContextOptional();
  const shell = useStudioShellContextOptional();
  const inlineText = useInlineTextEdit({
    onCommit: (commit) => actions?.handleDomRichTextCommit(commit),
    onLost: (reason) => shell?.showToast(textEditNotSaved(reason), "error"),
    onPause: () => usePlayerStore.getState().setIsPlaying(false),
  });
  const lastPressRef = useRef<PressMark | null>(null);

  /**
   * The element under this press, hit-tested now rather than read from state.
   *
   * Every cached answer in the overlay is React state that has not caught up
   * with the press happening now: the hover is documented as an async cache,
   * and the selection from the first press has not re-rendered. Reading either
   * meant the first double press on any element opened nothing, which is every
   * double press that matters.
   */
  const elementUnderPress = (event: { clientX: number; clientY: number }) => {
    const iframe = actions?.previewIframeRef?.current;
    if (!iframe) return null;
    // A sealed frame cannot be hit-tested from here; its first press already selected the element.
    if (previewFrameOpaque(iframe)) return selectionRef.current?.element ?? null;
    // The same hit test the canvas uses to decide what was clicked; a plain
    // elementFromPoint only finds wrappers, since Studio suppresses pointer events.
    return getPreviewTargetFromPointer(iframe, event.clientX, event.clientY);
  };

  /** A point on Studio's canvas, in the scaled composition's coordinates. */
  const compositionPoint = (event: { clientX: number; clientY: number }) => {
    const iframe = actions?.previewIframeRef?.current;
    const view = iframe?.contentWindow;
    if (!iframe || !view?.innerWidth) return undefined;
    const box = iframe.getBoundingClientRect();
    const scale = box.width / view.innerWidth || 1;
    return { x: (event.clientX - box.left) / scale, y: (event.clientY - box.top) / scale };
  };

  // Enter opens the selected element's text, the way every design tool does,
  // and is the dependable way in: a double press has to survive the canvas'
  // gesture machinery, while this is one key on a selection that has settled.
  const handleKeyDown = (event: KeyChord) => {
    if (!isPlainEnter(event) || inlineText.session) return false;
    const target = selectionRef.current;
    return Boolean(target && canOpenTextInline(target) && inlineText.start(target.element));
  };
  const handleKeyDownRef = useRef(handleKeyDown);
  handleKeyDownRef.current = handleKeyDown;
  // A host-mode canvas takes no presses of its own, so it is rarely focused;
  // with nothing focused, Enter comes via the window.
  useEffect(() => {
    if (!enterFromWindow) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const { body, documentElement } = window.document;
      if (event.defaultPrevented || (event.target !== body && event.target !== documentElement))
        return;
      if (handleKeyDownRef.current(event)) event.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enterFromWindow]);

  // Both script the frame's element and selection, which a sealed session keeps in the frame.
  const liveSession = inlineText.session?.sealed ? null : inlineText.session;
  return {
    editing: inlineText.session !== null,
    toolbar: (
      <>
        <InlineTextToolbar
          session={liveSession}
          iframe={actions?.previewIframeRef?.current ?? null}
        />
        <InlineTextCaret
          session={liveSession}
          iframe={actions?.previewIframeRef?.current ?? null}
        />
      </>
    ),
    handleKeyDown,
    startFromPress: (event) => {
      if (inlineText.session) return false;
      const element = elementUnderPress(event);
      const press = { x: event.clientX, y: event.clientY, at: Date.now(), element };
      const paired = isDoublePress(lastPressRef.current, press);
      lastPressRef.current = press;

      if (!paired || !element) return false;
      const selection = selectionRef.current;
      if (selection?.handle && selection.element === element)
        return canEditSealedTextInline(selection) && inlineText.start(element);
      if (!canEditElementTextInline(element)) return false;
      // The caret opens where the press landed, which means mapping the point
      // out of Studio's coordinates and into the composition's own.
      return inlineText.start(element, compositionPoint(event));
    },
  };
}
