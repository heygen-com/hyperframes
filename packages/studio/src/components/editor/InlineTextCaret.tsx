import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  caretBoxIn,
  caretColorOf,
  caretSideAfterKey,
  type CaretBox,
  type CaretSide,
  type TextEditCaret,
} from "@hyperframes/core/runtime/editing-port";
import type { InlineTextEditSession } from "../../hooks/useInlineTextEdit";
import { previewEditingClient } from "../../player/lib/previewChannel";

/** The drawn caret's width on screen, whatever the preview's scale. */
export const CARET_PX = 2;

interface CaretPlacement {
  left: number;
  top: number;
  height: number;
  color: string;
}

/**
 * The caret of a text edited in place, drawn at screen size: the preview is scaled, so the browser's 1 px caret
 * shrinks below a pixel. This one follows the real selection; the browser's own is transparent meanwhile.
 */
export function InlineTextCaret({
  session,
  iframe,
}: {
  session: InlineTextEditSession | null;
  iframe: HTMLIFrameElement | null;
}) {
  const [placement, setPlacement] = useState<CaretPlacement | null>(null);
  const sealed = session?.sealed ?? null;
  const element = sealed ? null : (session?.element ?? null);

  useEffect(() => {
    if (!element || !iframe) {
      setPlacement(null);
      return;
    }
    const doc = element.ownerDocument;
    const view = doc.defaultView;
    const color = caretColorOf(element);
    const ownCaret = element.style.caretColor;
    element.style.caretColor = "transparent";
    let composing = false;
    let side: CaretSide = "after";
    const update = () => {
      const box = composing ? null : caretBoxIn(element, side);
      setPlacement(box && onScreen(box, color, iframe, view?.innerWidth ?? 0));
    };
    const onKey = ({ key }: KeyboardEvent) => {
      side = caretSideAfterKey(key, side);
    };
    const onPress = () => void (side = "after");
    const composition = (on: boolean) => () => {
      composing = on;
      update();
    };
    const start = composition(true);
    const end = composition(false);
    doc.addEventListener("selectionchange", update);
    element.addEventListener("keydown", onKey);
    element.addEventListener("pointerdown", onPress);
    element.addEventListener("input", update);
    element.addEventListener("focus", update);
    element.addEventListener("blur", update);
    element.addEventListener("compositionstart", start);
    element.addEventListener("compositionend", end);
    view?.addEventListener("resize", update);
    view?.addEventListener("scroll", update, true);
    const stopFollowing = followFrameBox(iframe, update);
    return () => {
      stopFollowing();
      doc.removeEventListener("selectionchange", update);
      element.removeEventListener("keydown", onKey);
      element.removeEventListener("pointerdown", onPress);
      element.removeEventListener("input", update);
      element.removeEventListener("focus", update);
      element.removeEventListener("blur", update);
      element.removeEventListener("compositionstart", start);
      element.removeEventListener("compositionend", end);
      view?.removeEventListener("resize", update);
      view?.removeEventListener("scroll", update, true);
      element.style.caretColor = ownCaret;
    };
  }, [element, iframe]);

  // A sealed frame keeps the selection itself and posts where its caret stands, in its own px.
  useEffect(() => {
    if (!sealed || !iframe) return;
    let last: TextEditCaret | null = null;
    const update = () =>
      setPlacement(
        last && insideFrame(onScreen(last, last.color, iframe, last.viewportWidth), iframe),
      );
    const stopListening = previewEditingClient(sealed.iframe).onTextEditSelection((event) => {
      if (event.handle !== sealed.handle) return;
      last = event.caret;
      update();
    });
    const stopFollowing = followFrameBox(iframe, update);
    return () => {
      stopListening();
      stopFollowing();
      setPlacement(null);
    };
  }, [sealed, iframe]);

  if (!placement || !iframe) return null;
  // On Studio's body: a transformed ancestor in the canvas would make `fixed` relative to itself, not the viewport.
  return createPortal(
    <div
      // Keyed on where it stands, so each move starts the blink lit, as the system caret does.
      key={`${placement.left},${placement.top}`}
      data-inline-text-caret="true"
      aria-hidden="true"
      className="hf-inline-text-caret pointer-events-none fixed z-200"
      style={{
        left: placement.left,
        top: placement.top,
        width: CARET_PX,
        height: placement.height,
        background: placement.color,
      }}
    />,
    iframe.ownerDocument.body,
  );
}

/** A caret box in the frame's px, on Studio's screen: the frame is drawn `box.width / viewportWidth` of its size. */
function onScreen(
  caret: CaretBox,
  color: string,
  iframe: HTMLIFrameElement,
  viewportWidth: number,
): CaretPlacement {
  const box = iframe.getBoundingClientRect();
  const scale = viewportWidth ? box.width / viewportWidth : 1;
  return {
    left: box.left + caret.left * scale - CARET_PX / 2,
    top: box.top + caret.top * scale,
    height: caret.height * scale,
    color,
  };
}

/** A sealed frame says where its caret stands; Studio draws it only inside the frame's box. */
function insideFrame(placement: CaretPlacement, iframe: HTMLIFrameElement): CaretPlacement | null {
  const box = iframe.getBoundingClientRect();
  const top = Math.max(placement.top, box.top);
  const bottom = Math.min(placement.top + placement.height, box.top + box.height);
  if (bottom <= top) return null;
  const left = Math.min(Math.max(placement.left, box.left), box.left + box.width - CARET_PX);
  return { ...placement, left, top, height: bottom - top };
}

/** The preview moves by transforms (the player's scale, a pan or zoom of the stage) that fire no event: the frame's
 * box is checked each frame and `moved` runs when it changes. */
function followFrameBox(iframe: HTMLIFrameElement, moved: () => void): () => void {
  const studio = iframe.ownerDocument.defaultView;
  let box = "";
  let frame = 0;
  const follow = () => {
    const { left, top, width, height } = iframe.getBoundingClientRect();
    const now = `${left},${top},${width},${height}`;
    if (now !== box) {
      box = now;
      moved();
    }
    frame = studio?.requestAnimationFrame(follow) ?? 0;
  };
  follow();
  return () => studio?.cancelAnimationFrame(frame);
}
