import { useEffect, useState } from "react";
import type { InlineTextEditSession } from "../../hooks/useInlineTextEdit";

/** The drawn caret's width on screen, whatever the preview's scale. */
export const CARET_PX = 2;

interface CaretPlacement {
  left: number;
  top: number;
  height: number;
  color: string;
}

/**
 * The caret of a text edited in place, drawn in Studio's document at screen size.
 *
 * The composition is drawn at its own size and shown scaled, so the browser's 1 px caret shrinks below a pixel and
 * cannot be seen. This one follows the real selection, and the browser's own is made transparent meanwhile.
 */
export function InlineTextCaret({
  session,
  iframe,
}: {
  session: InlineTextEditSession | null;
  iframe: HTMLIFrameElement | null;
}) {
  const [placement, setPlacement] = useState<CaretPlacement | null>(null);
  const element = session?.element ?? null;

  useEffect(() => {
    if (!element || !iframe) {
      setPlacement(null);
      return;
    }
    const doc = element.ownerDocument;
    const view = doc.defaultView;
    const studio = iframe.ownerDocument.defaultView;
    // The player scales the iframe by a transform when its own box resizes, which the iframe's size never shows.
    const player =
      iframe.getRootNode() instanceof ShadowRoot
        ? (iframe.getRootNode() as ShadowRoot).host
        : iframe;
    const color = caretColorOf(element);
    const ownCaret = element.style.caretColor;
    element.style.caretColor = "transparent";
    let composing = false;
    const update = () => setPlacement(composing ? null : placeAtCaret(element, iframe, color));
    const composition = (on: boolean) => () => {
      composing = on;
      update();
    };
    const start = composition(true);
    const end = composition(false);
    const resized = new ResizeObserver(update);
    resized.observe(player);
    doc.addEventListener("selectionchange", update);
    element.addEventListener("input", update);
    element.addEventListener("focus", update);
    element.addEventListener("blur", update);
    element.addEventListener("compositionstart", start);
    element.addEventListener("compositionend", end);
    view?.addEventListener("resize", update);
    view?.addEventListener("scroll", update, true);
    studio?.addEventListener("scroll", update, true);
    update();
    return () => {
      resized.disconnect();
      doc.removeEventListener("selectionchange", update);
      element.removeEventListener("input", update);
      element.removeEventListener("focus", update);
      element.removeEventListener("blur", update);
      element.removeEventListener("compositionstart", start);
      element.removeEventListener("compositionend", end);
      view?.removeEventListener("resize", update);
      view?.removeEventListener("scroll", update, true);
      studio?.removeEventListener("scroll", update, true);
      element.style.caretColor = ownCaret;
    };
  }, [element, iframe]);

  if (!placement) return null;
  return (
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
    />
  );
}

/** The colour the browser would draw its caret in: `caret-color`, or the text's colour when that is `auto`. */
function caretColorOf(element: HTMLElement): string {
  const style = element.ownerDocument.defaultView?.getComputedStyle(element);
  if (!style) return "currentColor";
  return style.caretColor && style.caretColor !== "auto" ? style.caretColor : style.color;
}

/** Where the caret stands on Studio's screen, or null when there is none to draw: a range selected, the text not
 * focused, or the selection outside it. */
function placeAtCaret(
  element: HTMLElement,
  iframe: HTMLIFrameElement,
  color: string,
): CaretPlacement | null {
  const doc = element.ownerDocument;
  const view = doc.defaultView;
  const selection = view?.getSelection();
  if (!view || !selection || selection.rangeCount === 0 || !selection.isCollapsed) return null;
  if (!doc.hasFocus() || !element.contains(doc.activeElement)) return null;
  const range = selection.getRangeAt(0);
  if (!element.contains(range.startContainer)) return null;
  const rect = caretRect(range, element, view);
  // The composition is drawn scaled into the iframe's box: the same mapping the toolbar uses.
  const box = iframe.getBoundingClientRect();
  const scale = view.innerWidth ? box.width / view.innerWidth : 1;
  return {
    left: box.left + rect.left * scale - CARET_PX / 2,
    top: box.top + rect.top * scale,
    height: rect.height * scale,
    color,
  };
}

/** The collapsed range's box on its line. A caret between two nodes has none, so it stands beside them; an empty
 * text has neither, so it stands at the text's start, one line tall. */
function caretRect(range: Range, element: HTMLElement, view: Window) {
  const last = [...range.getClientRects()].reverse().find((rect) => rect.height > 0);
  if (last) return { left: last.left, top: last.top, height: last.height };
  const beside = besideNode(range);
  if (beside) return beside;
  const style = view.getComputedStyle(element);
  const box = element.getBoundingClientRect();
  const fontSize = Number.parseFloat(style.fontSize) || 16;
  const line = Number.parseFloat(style.lineHeight) || fontSize * 1.2;
  return {
    left: box.left + (Number.parseFloat(style.paddingLeft) || 0),
    top: box.top + (Number.parseFloat(style.paddingTop) || 0),
    height: line,
  };
}

/** At an element boundary: the end of the node before, or the start of the node after (a line break's own line). */
function besideNode(range: Range) {
  const { startContainer: at, startOffset: offset } = range;
  // An empty text node is a boundary too, between its siblings.
  const text = at.nodeType === Node.TEXT_NODE;
  const before = text ? at.previousSibling : at.childNodes[offset - 1];
  const after = text ? at.nextSibling : at.childNodes[offset];
  const node = before && before.nodeName !== "BR" ? before : (after ?? before);
  if (!node) return null;
  const around = range.cloneRange();
  around.selectNode(node);
  const rects = [...around.getClientRects()].filter((rect) => rect.height > 0);
  const rect = node === before ? rects.at(-1) : rects[0];
  if (!rect) return null;
  return { left: node === before ? rect.right : rect.left, top: rect.top, height: rect.height };
}
