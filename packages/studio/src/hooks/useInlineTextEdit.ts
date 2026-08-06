import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Editing an element's text where it sits, in the composition itself.
 *
 * The alternative is an input positioned over the element, which has to
 * reproduce its font, size, weight, spacing, colour, alignment and wrapping to
 * look right, and is subtly wrong the moment any of those is missed. The
 * preview is a same-origin document holding the real element, and the commit
 * path already mutates that exact node, so the element is both the most
 * accurate surface to type into and the one the rest of the code understands.
 *
 * The session owns the element's editable state for its whole life, and tears
 * down the same way whichever way it ends. A session that failed to close
 * would leave the canvas unable to select anything.
 */

/** `plaintext-only` is what keeps a text edit from becoming a structural one. */
const EDITABLE = "plaintext-only";

export interface InlineTextEditSession {
  element: HTMLElement;
  /** What the element said when editing started, for putting back on cancel. */
  original: string;
}

export interface InlineTextEditControls {
  session: InlineTextEditSession | null;
  /** Begin editing this element. Returns false when a session is already open. */
  start: (element: HTMLElement) => boolean;
  /** Hand the current text to the commit function and close. */
  commit: () => void;
  /** Put the original text back and close, persisting nothing. */
  cancel: () => void;
}

export function useInlineTextEdit({
  onCommit,
  onPause,
}: {
  /** Where the edited text goes. The caller owns persistence. */
  onCommit: (text: string) => void;
  /** Stop playback, so the element is not animating under the caret. */
  onPause?: () => void;
}): InlineTextEditControls {
  const [session, setSession] = useState<InlineTextEditSession | null>(null);
  // The teardown reads this rather than the state, so an exit path that runs
  // before React re-renders still sees the element it has to clean up.
  const openRef = useRef<InlineTextEditSession | null>(null);

  const teardown = useCallback((): InlineTextEditSession | null => {
    const open = openRef.current;
    if (!open) return null;
    openRef.current = null;
    setSession(null);
    // An element removed from the document mid-session is not an error, it is
    // just nothing left to clean up.
    if (open.element.isConnected) {
      open.element.removeAttribute("contenteditable");
      open.element.blur();
    }
    return open;
  }, []);

  const start = useCallback(
    (element: HTMLElement): boolean => {
      if (openRef.current) return false;

      const open = { element, original: element.textContent ?? "" };
      openRef.current = open;
      setSession(open);
      onPause?.();

      element.setAttribute("contenteditable", EDITABLE);
      element.focus({ preventScroll: true });
      selectAll(element);
      return true;
    },
    [onPause],
  );

  const commit = useCallback(() => {
    const open = openRef.current;
    if (!open) return;
    const text = open.element.textContent ?? "";
    teardown();
    // After teardown, so the commit path's own resync does not fight an
    // element that is still editable.
    onCommit(text);
  }, [onCommit, teardown]);

  const cancel = useCallback(() => {
    const open = openRef.current;
    if (!open) return;
    if (open.element.isConnected) open.element.textContent = open.original;
    teardown();
  }, [teardown]);

  // The keys belong to the element, not to the document: the element lives in
  // the preview's own document, so a listener on Studio's would never see them.
  useEffect(() => {
    const element = session?.element;
    if (!element) return;

    const onKeyDown = (event: KeyboardEvent) => {
      // Shift+Enter is a line break in a multi-line element, and is left alone.
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        commit();
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        cancel();
      }
    };
    // Clicking away keeps the work, which is what every other field in Studio
    // does and what a user who has just typed something expects.
    const onBlur = () => commit();

    element.addEventListener("keydown", onKeyDown);
    element.addEventListener("blur", onBlur);
    return () => {
      element.removeEventListener("keydown", onKeyDown);
      element.removeEventListener("blur", onBlur);
    };
  }, [session, commit, cancel]);

  return { session, start, commit, cancel };
}

/** Select the whole text, so the first keystroke replaces it. */
function selectAll(element: HTMLElement): void {
  const doc = element.ownerDocument;
  const selection = doc.defaultView?.getSelection();
  if (!selection) return;
  const range = doc.createRange();
  range.selectNodeContents(element);
  selection.removeAllRanges();
  selection.addRange(range);
}
