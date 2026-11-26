export type CaretSide = "before" | "after";
export type CaretBox = { left: number; top: number; height: number };

const MODIFIERS = new Set(["Shift", "Control", "Alt", "Meta"]);
// Only End leaves Chrome's own caret at the earlier line's end; an arrow onto a wrap point lands on the next line.
const SIDE_OF_KEY: Record<string, CaretSide> = { End: "before" };

/** The DOM has no side for a soft-wrap point (one line's end is the next one's start): the key that moved there says
 * which, as CodeMirror and ProseMirror keep it. */
export const caretSideAfterKey = (key: string, side: CaretSide): CaretSide =>
  MODIFIERS.has(key) ? side : (SIDE_OF_KEY[key] ?? "after");

export function caretBoxIn(element: HTMLElement, side: CaretSide): CaretBox | null {
  const view = element.ownerDocument.defaultView;
  const range = view ? caretRange(element, view) : null;
  if (!view || !range) return null;
  return (side === "before" && endOfCharBefore(range)) || caretRect(range, element, view);
}

export function caretColorOf(element: HTMLElement): string {
  const style = element.ownerDocument.defaultView?.getComputedStyle(element);
  if (!style) return "currentColor";
  return style.caretColor && style.caretColor !== "auto" ? style.caretColor : style.color;
}

/** A caret between two nodes has no box, so it stands beside them; in an empty text, at its start, one line tall. */
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

function caretRange(element: HTMLElement, view: Window): Range | null {
  const doc = element.ownerDocument;
  const selection = view.getSelection();
  if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) return null;
  if (!doc.hasFocus() || !element.contains(doc.activeElement)) return null;
  const range = selection.getRangeAt(0);
  return element.contains(range.startContainer) ? range : null;
}

/** Where a caret that came from before a soft-wrap point stands: the right edge of the character before it. */
function endOfCharBefore({ startContainer: at, startOffset: offset }: Range) {
  if (at.nodeType !== Node.TEXT_NODE || offset === 0) return null;
  const char = at.ownerDocument!.createRange();
  // An emoji's second half alone has no box: take the whole pair.
  const low = /[\uDC00-\uDFFF]/.test((at as Text).data[offset - 1] ?? "");
  char.setStart(at, offset - (low && offset > 1 ? 2 : 1));
  char.setEnd(at, offset);
  // A trailing space at a wrap has a box on each line; the earlier line's comes first.
  const rect = [...char.getClientRects()].find((each) => each.height > 0);
  return rect ? { left: rect.right, top: rect.top, height: rect.height } : null;
}

/** At an element boundary: the end of the node before, or the start of the node after (a line break's own line). */
function besideNode(range: Range) {
  const [before, after] = neighbours(range);
  const node = before && before.nodeName !== "BR" ? before : (after ?? before);
  if (!node) return null;
  const around = range.cloneRange();
  around.selectNode(node);
  const rects = [...around.getClientRects()].filter((rect) => rect.height > 0);
  const end = node === before;
  const rect = end ? rects.at(-1) : rects[0];
  return rect ? { left: end ? rect.right : rect.left, top: rect.top, height: rect.height } : null;
}

function neighbours({ startContainer: at, startOffset: offset }: Range) {
  return at.nodeType === Node.TEXT_NODE
    ? [at.previousSibling, at.nextSibling]
    : [at.childNodes[offset - 1] ?? null, at.childNodes[offset] ?? null];
}

/** Puts the caret after the last character, with nothing selected: into the last text node rather than past the last
 * child, since a caret at a node boundary types in the right place but stands somewhere else on screen. */
export function placeCaretAtEnd(element: HTMLElement): void {
  const doc = element.ownerDocument;
  const selection = doc.defaultView?.getSelection();
  if (!selection) return;
  const range = doc.createRange();
  const last = element.lastChild;
  if (last && last.nodeType === Node.TEXT_NODE) {
    range.setStart(last, last.textContent?.length ?? 0);
    range.collapse(true);
  } else {
    range.selectNodeContents(element);
    range.collapse(false);
  }
  selection.removeAllRanges();
  selection.addRange(range);
}
