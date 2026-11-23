import { useCallback, useEffect, useRef, useState } from "react";
import { sanitizeRichTextChildren } from "@hyperframes/core/rich-text-sanitize";
import { usePreviewReadOnly } from "../components/editor/previewReadOnlyContext";
import { holdSealedFrameKeyboard } from "../player/lib/sealedFrameKeyboard";
import { settleOnDrain, trackStudioPendingEdit } from "../utils/studioPendingEdits";
import {
  isTextTargetWriting,
  landedTextFor,
  nextTextSaveOrder,
  orderedSave,
  queueTextSave,
  textSavesSettled,
} from "./textSaves";
import {
  beginStudioManualEditGesture,
  endStudioManualEditGesture,
  countStudioManualEditSave,
} from "../components/editor/manualEditGesture";
import { previewStandIn } from "../components/editor/previewDrafts";
import { requestOverlayFrames } from "../components/editor/overlayFrameLoop";
import { previewEditingClient, previewRequest } from "../player/lib/previewChannel";
import { editPreviewElement, previewTextEdit } from "../player/lib/previewElements";
import { caretRangeAt, takePlainTextOnly } from "@hyperframes/core/runtime/editing-port";

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

/** Typing in a sealed frame raises no event in Studio, so its box wakes the selection overlay as it grows. */
function followSealedTyping({ iframe, handle }: { iframe: HTMLIFrameElement; handle: string }) {
  let last = "";
  const stop = previewEditingClient(iframe).onGeometry(({ elements }) => {
    const box = JSON.stringify(elements[0]?.rect ?? null);
    if (box === last) return;
    last = box;
    requestOverlayFrames();
  });
  void previewRequest(iframe, "watch-geometry", { handles: [handle] });
  return () => {
    stop();
    void previewRequest(iframe, "watch-geometry", { handles: [] });
  };
}

/**
 * `true`, not `plaintext-only`.
 *
 * `plaintext-only` was what kept a text edit from becoming a structural one,
 * and it also made it impossible to give three characters a colour, which is
 * the point of editing in the composition rather than in a field. The guard it
 * was providing is rebuilt as two narrower ones that do not cost the feature:
 * paste arrives as plain text, and what leaves the element goes through the
 * sanitiser before anyone writes it to a file.
 */
const EDITABLE = "true";
/** Studio's accent, so the mark belongs to Studio rather than to the design. */
const EDITING_OUTLINE = "2px solid #3CE6AC";

export interface InlineTextEditSession {
  element: HTMLElement;
  /**
   * The element's markup when editing started, for putting back on cancel.
   * Markup rather than text: cancelling an edit that recoloured a word has to
   * restore the colours it replaced, not just the letters.
   */
  original: string;
  /** The element's own outline, to put back when the session ends. */
  outline: string;
  /** The element's own outline offset, restored with the outline. */
  outlineOffset: string;
  /** Holds the preview on screen while the edit is open. */
  gesture?: string;
  /** A sealed preview's stand-in: the frame runs the edit, reached through its editing port. */
  sealed?: { iframe: HTMLIFrameElement; handle: string };
  keyboard?: () => void;
}

/** The live markup to persist and the session snapshot to restore on failure. */
export interface InlineTextEditCommit {
  /** The exact preview node that owned the edit; a reload must not retarget it. */
  element: HTMLElement;
  html: string;
  previousHtml: string;
}

export interface InlineTextEditControls {
  session: InlineTextEditSession | null;
  /**
   * Begin editing this element. `caretAt` is a point in the element's own
   * document, so the caret can open where the user pointed rather than at a
   * fixed end. Returns false when a session is already open.
   */
  start: (element: HTMLElement, caretAt?: { x: number; y: number }) => boolean;
  /** Hand the current text to the commit function and close. */
  commit: () => void;
  /** Put the original text back and close, persisting nothing. */
  cancel: () => void;
}

/**
 * Drop the text selection, but only when it lives inside this element.
 *
 * A selection somewhere else in the preview belongs to whatever put it there
 * and is not this session's to clear.
 */
function clearSelectionWithin(element: HTMLElement): void {
  const selection = element.ownerDocument.defaultView?.getSelection();
  if (!selection || selection.rangeCount === 0) return;
  const range = selection.getRangeAt(0);
  if (!element.contains(range.startContainer) && !element.contains(range.endContainer)) return;
  selection.removeAllRanges();
}

/** What to save; an untouched draft is nothing, so a removed or re-rendered element raises no message. */
function keptMarkup(outcome: { html: string | null; previous: string | null }) {
  const { html, previous } = outcome;
  if (html === null || previous === null || html === previous) return null;
  return { html, previousHtml: previous };
}

const PREVIEW_DID_NOT_ANSWER = "the preview did not answer";

// The newest session per element: an older one that settles late must not write over it.
const latestEdit = new WeakMap<HTMLElement, InlineTextEditSession>();
const openSealedEdit = new WeakMap<HTMLElement, InlineTextEditSession>();
const settledWhileSaving = new WeakMap<HTMLElement, InlineTextEditSession>();

// The frame shows this session's original once it ends unsaved; a save that landed meanwhile shows over it.
function showLanded(open: InlineTextEditSession): void {
  const saved = landedTextFor(open.element);
  const { sealed, original } = open;
  if (!sealed || saved === undefined || saved === original) return;
  void editPreviewElement(sealed.iframe, sealed.handle, { html: saved, expect: original });
}

function sealedEditSettled(open: InlineTextEditSession, saving?: Promise<unknown>): void {
  // The draft lives in the frame until its save has read it, so a held reload waits for that save.
  const endGesture = () => endStudioManualEditGesture(open.element, open.gesture);
  void Promise.resolve(saving).then(endGesture, endGesture);
  if (openSealedEdit.get(open.element) === open) openSealedEdit.delete(open.element);
  if (isTextTargetWriting(open.element)) settledWhileSaving.set(open.element, open);
  else showLanded(open);
}

/** A text save of `element` ended: an edit that ended while it ran shows what landed, once nothing else runs. */
export function textSaveEnded(element: HTMLElement): void {
  const open = settledWhileSaving.get(element);
  if (!open || isTextTargetWriting(element) || openSealedEdit.has(element)) return;
  settledWhileSaving.delete(element);
  showLanded(open);
}

function frameGone(open: InlineTextEditSession, keep: boolean, onLost?: (reason: string) => void) {
  const { sealed, original } = open;
  const newest = latestEdit.get(open.element) === open;
  if (sealed && original && newest)
    void editPreviewElement(sealed.iframe, sealed.handle, { html: original });
  if (keep) onLost?.(PREVIEW_DID_NOT_ANSWER);
}

/** Ends a live session when its element leaves its document, focused or not. */
function endWhenRemoved(element: HTMLElement, end: () => void): () => void {
  const observer = new MutationObserver(() => {
    if (!element.isConnected) end();
  });
  observer.observe(element.ownerDocument, { childList: true, subtree: true });
  if (!element.isConnected) queueMicrotask(end);
  return () => observer.disconnect();
}

function takeDraft(open: InlineTextEditSession): string {
  const html = open.element.innerHTML;
  // A removed element's save is refused; it must not come back showing the draft.
  if (!open.element.isConnected) open.element.innerHTML = open.original;
  return html;
}

const openOn = new WeakMap<HTMLElement, () => unknown>();
const savingOn = new WeakMap<HTMLElement, Promise<unknown>>();

/** A draft's save counts as in flight from its request until it settles, so every later save on it waits. */
function handedOff<T>(element: HTMLElement, saving: T): T {
  const run = queueTextSave(element, Promise.resolve(saving));
  savingOn.set(element, run);
  const done = () => void (savingOn.get(element) === run && savingOn.delete(element));
  run.then(done, done);
  return saving;
}

/** Ends the inline edit open on `element`, keeping its draft, or waits for one already ending, before the caller. */
export function endInlineEditOn(element: HTMLElement): Promise<void> {
  const end = openOn.get(element);
  return Promise.resolve(end ? end() : savingOn.get(element)).then(
    () => {},
    () => {},
  );
}

// A drain or an unmount keeps the typed words, as blur does. Read through a ref
// so a new onCommit never closes the session mid-edit.
function useSessionEnds(
  session: InlineTextEditSession | null,
  openRef: { current: InlineTextEditSession | null },
  latestSave: () => unknown,
) {
  const save = useRef(latestSave);
  save.current = latestSave;
  useEffect(() => settleWhileOpen(session, openRef, save), [session, openRef]);
  useEffect(() => () => session?.keyboard?.(), [session]);
  // A frame may never say its edit ended: Studio taking focus back ends it, saving, as the frame's blur would.
  useEffect(() => {
    const studioWindow = session?.sealed?.iframe.ownerDocument.defaultView;
    if (!studioWindow) return undefined;
    const backInStudio = () => openRef.current === session && save.current();
    studioWindow.addEventListener("focus", backInStudio);
    return () => studioWindow.removeEventListener("focus", backInStudio);
  }, [session, openRef]);
}

function settleWhileOpen(
  session: InlineTextEditSession | null,
  openRef: { current: InlineTextEditSession | null },
  save: { current: () => unknown },
) {
  if (!session) return undefined;
  const settle = () => openRef.current === session && save.current();
  const stop = settleOnDrain(settle);
  openOn.set(session.element, settle);
  return () => {
    stop();
    if (openOn.get(session.element) === settle) openOn.delete(session.element);
    void settle();
  };
}

/** Ends the frame's session with its original back, as a refused or failed reply must. */
function endWithOriginal(sealed: NonNullable<InlineTextEditSession["sealed"]>): void {
  void previewTextEdit(sealed.iframe, { handle: sealed.handle, action: "end", keep: false });
}

export function useInlineTextEdit({
  onCommit,
  onPause,
  onLost,
}: {
  /** Where the edited text goes. The caller owns persistence. */
  onCommit: (commit: InlineTextEditCommit) => unknown;
  /** Told why typed text could not be saved, when no save was attempted. */
  onLost?: (reason: string) => void;
  /** Stop playback, so the element is not animating under the caret. */
  onPause?: () => void;
}): InlineTextEditControls {
  const readOnly = usePreviewReadOnly();
  const [session, setSession] = useState<InlineTextEditSession | null>(null);
  // The teardown reads this rather than the state, so an exit path that runs
  // before React re-renders still sees the element it has to clean up.
  const openRef = useRef<InlineTextEditSession | null>(null);
  /** The pending caret placement, so a session that closes first can drop it. */
  const framesRef = useRef<number | null>(null);

  const teardown = useCallback((): InlineTextEditSession | null => {
    const open = openRef.current;
    if (!open) return null;
    if (framesRef.current !== null) {
      open.element.ownerDocument.defaultView?.cancelAnimationFrame(framesRef.current);
      framesRef.current = null;
    }
    openRef.current = null;
    setSession(null);
    open.keyboard?.();
    if (open.sealed) return open;
    endStudioManualEditGesture(open.element, open.gesture);
    // Cleaned even when removed mid-session: a parked scene's element comes back.
    open.element.removeAttribute("contenteditable");
    // Restored rather than cleared: the composition may have authored one.
    open.element.style.outline = open.outline;
    open.element.style.outlineOffset = open.outlineOffset;
    if (open.element.isConnected) {
      // Drop the highlight too. Removing contenteditable and blurring leaves a
      // selection made inside the element painted on screen, so a word picked
      // with a double press stayed grey after the click that closed the edit.
      clearSelectionWithin(open.element);
      open.element.blur();
    }
    return open;
  }, []);

  const start = useCallback(
    (element: HTMLElement, caretAt?: { x: number; y: number }): boolean => {
      if (openRef.current || readOnly) return false;
      const sealed = previewStandIn(element);
      if (sealed) {
        const gesture = beginStudioManualEditGesture(element, "edit");
        const keyboard = holdSealedFrameKeyboard(sealed.iframe);
        const open = {
          element,
          original: "",
          outline: "",
          outlineOffset: "",
          sealed,
          gesture,
          keyboard,
        };
        openRef.current = open;
        latestEdit.set(element, open);
        openSealedEdit.set(element, open);
        setSession(open);
        onPause?.();
        sealed.iframe.focus();
        const params = { handle: sealed.handle, action: "start" as const, caret: null };
        // Saves land in gesture order, as a scriptable preview applies them, so the edit opens on their text.
        const begin = () =>
          openRef.current === open ? previewTextEdit(sealed.iframe, params) : Promise.resolve(null);
        const settled = textSavesSettled(element);
        void (settled ? settled.then(begin) : begin()).then((reply) => {
          if (openRef.current !== open) return;
          if (reply?.applied) open.original = reply.previous ?? "";
          // An unanswered start may still have opened the edit; it ends as any edit does, which saves or reports.
          else if (reply !== null) {
            teardown();
            sealedEditSettled(open);
          }
        });
        return true;
      }

      const open = {
        element,
        original: element.innerHTML,
        outline: element.style.outline,
        outlineOffset: element.style.outlineOffset,
        gesture: beginStudioManualEditGesture(element, "edit"),
      };
      // Drawn on the element itself, not in Studio's overlay above it. This is
      // the only mark that says the caret is in the TEXT rather than the
      // element being selected, and it has to sit in the same document as the
      // caret to read that way.
      element.style.outline = EDITING_OUTLINE;
      element.style.outlineOffset = "2px";
      openRef.current = open;
      latestEdit.set(element, open);
      setSession(open);
      onPause?.();

      element.setAttribute("contenteditable", EDITABLE);
      // Focused and selected on the next frame, not now. The press that opened
      // this is still in flight: the canvas overlay takes focus on its own
      // pointer-down, and the click that follows puts a caret in the element
      // and collapses any selection. Doing it after all of that is what lands.
      const view = element.ownerDocument.defaultView;
      const raf = view?.requestAnimationFrame(() => {
        framesRef.current = null;
        if (openRef.current?.element !== element) return;
        element.focus({ preventScroll: true });
        placeCaret(element, caretAt);
      });
      framesRef.current = raf ?? null;
      return true;
    },
    [onPause, readOnly, teardown],
  );

  const endSealed = useCallback(
    (open: InlineTextEditSession, keep: boolean) => {
      const sealed = open.sealed!;
      const order = nextTextSaveOrder();
      // A session the frame already closed (a blur) posted its outcome ahead of this end's reply.
      let endedFirst: { html: string | null; previous: string } | null = null;
      const stopListening = previewEditingClient(sealed.iframe).onTextEditEnded((ended) => {
        if (ended.handle === sealed.handle) endedFirst ??= ended;
      });
      const params = { handle: sealed.handle, action: "end" as const, keep };
      const ended = previewTextEdit(sealed.iframe, params).then((reply) => {
        stopListening();
        const outcome = reply?.applied ? reply : endedFirst;
        if (!outcome) return reply === null && frameGone(open, keep, onLost);
        const kept = keptMarkup(outcome);
        if (!kept) return;
        if (keep) return onCommit(orderedSave({ element: open.element, ...kept }, order));
        if (outcome === endedFirst) {
          const back = { html: kept.previousHtml, expect: kept.html };
          void editPreviewElement(sealed.iframe, sealed.handle, back);
        }
      });
      return trackStudioPendingEdit(ended.finally(() => sealedEditSettled(open)));
    },
    [onCommit, onLost],
  );

  const save = useCallback(() => {
    const open = openRef.current;
    if (!open) return;
    if (open.sealed) {
      teardown();
      return handedOff(open.element, endSealed(open, true));
    }
    // Sanitised here, in the element, so the preview shows exactly what will be
    // saved rather than something the server will quietly cut down.
    sanitizeRichTextChildren(open.element);
    const html = takeDraft(open);
    if (html === open.original) return void teardown();
    // Counted and pending before the edit closes, so a reload waits for the save, not the mark.
    let settle: (saving: unknown) => void = () => {};
    const saving = trackStudioPendingEdit(new Promise((resolve) => (settle = resolve)));
    const commitText = () => {
      teardown();
      // After teardown, so the commit path's own resync does not fight an
      // element that is still editable.
      return onCommit(orderedSave({ element: open.element, html, previousHtml: open.original }));
    };
    settle(countStudioManualEditSave(open.element, commitText));
    return handedOff(open.element, saving);
  }, [onCommit, teardown, endSealed]);
  const commit = useCallback(() => void save(), [save]);

  const cancel = useCallback(() => {
    const open = openRef.current;
    if (!open) return;
    if (open.sealed) {
      teardown();
      return void endSealed(open, false);
    }
    open.element.innerHTML = open.original;
    teardown();
  }, [teardown, endSealed]);

  // A sealed frame ends the edit itself on Enter, Escape or a press elsewhere, and says what it kept.
  useEffect(() => {
    const sealed = session?.sealed;
    if (!session || !sealed) return;
    const stopFollowing = followSealedTyping(sealed);
    const stopEnded = previewEditingClient(sealed.iframe).onTextEditEnded((ended) => {
      if (openRef.current !== session || ended.handle !== sealed.handle) return;
      teardown();
      const kept = keptMarkup(ended);
      if (ended.html === null) endWithOriginal(sealed);
      const saving = kept
        ? trackStudioPendingEdit(
            handedOff(
              session.element,
              Promise.resolve(onCommit(orderedSave({ element: session.element, ...kept }))),
            ),
          )
        : undefined;
      sealedEditSettled(session, saving);
    });
    return () => {
      stopEnded();
      stopFollowing();
    };
  }, [session, teardown, onCommit]);

  // Read-only can be enabled while an edit is already open. Close that
  // session as a cancellation so the preview cannot keep committing through
  // the now-disabled editing surface.
  useEffect(() => {
    if (readOnly && openRef.current) cancel();
  }, [cancel, readOnly]);

  // The keys belong to the element, not to the document: the element lives in
  // the preview's own document, so a listener on Studio's would never see them.
  useEffect(() => {
    const element = session?.element;
    if (!element || session.sealed) return;

    const onKeyDown = (event: KeyboardEvent) => {
      // Shift+Enter is a line break in a multi-line element, and is left alone.
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        commit();
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        commit();
      }
    };
    // Clicking away keeps the work, which is what every other field in Studio
    // does and what a user who has just typed something expects.
    const onBlur = () => commit();
    // Nothing here for double or triple click: the browser already takes the
    // word on two and the whole text on three, which is what a text field does
    // everywhere else. Dropping `plaintext-only` means paste and drop would otherwise
    // put a whole web page's markup straight in; what arrives is the words.
    const releasePlainText = takePlainTextOnly(element);
    const stopWatching = endWhenRemoved(element, commit);
    element.addEventListener("keydown", onKeyDown);
    element.addEventListener("blur", onBlur);
    return () => {
      releasePlainText();
      stopWatching();
      element.removeEventListener("keydown", onKeyDown);
      element.removeEventListener("blur", onBlur);
    };
  }, [session, commit]);

  useSessionEnds(session, openRef, save);

  return { session, start, commit, cancel };
}

/**
 * Put the caret where the user pointed, or after the last character.
 *
 * Opening on a point is what makes this feel like text rather than a dialog:
 * the caret lands between the two letters that were clicked, exactly as it
 * would in any other editor.
 */
function placeCaret(element: HTMLElement, at?: { x: number; y: number }): void {
  const doc = element.ownerDocument;
  const selection = doc.defaultView?.getSelection();
  if (!selection) return;

  const range = at ? caretRangeAt(doc, at) : null;
  if (range && element.contains(range.startContainer)) {
    selection.removeAllRanges();
    selection.addRange(range);
    return;
  }
  placeCaretAtEnd(element);
}

/**
 * Put the caret after the last character, with nothing selected.
 *
 * Selecting the whole text would mean the next keystroke silently destroys it,
 * which is a bad thing to do to someone who double-clicked to fix a typo. A
 * caret at the end is where a person who wants to keep typing expects to be,
 * and everything else stays available: click anywhere to move it, drag to
 * select, Cmd+A to take the lot.
 */
function placeCaretAtEnd(element: HTMLElement): void {
  const doc = element.ownerDocument;
  const selection = doc.defaultView?.getSelection();
  if (!selection) return;
  const range = doc.createRange();
  // Into the text node, not just past the last child: collapsing the element's
  // contents leaves the caret at a node boundary, which types in the right
  // place but reports itself as "after child 0" and is a different position
  // from the one the user sees at the end of the word.
  const last = element.lastChild;
  if (last && last.nodeType === 3) {
    range.setStart(last, last.textContent?.length ?? 0);
    range.collapse(true);
  } else {
    range.selectNodeContents(element);
    range.collapse(false);
  }
  selection.removeAllRanges();
  selection.addRange(range);
}
