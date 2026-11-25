// `text-edit`: one in-place text editing session in the frame, for a parent that cannot script it.
// It edits only an element it handed a handle for, and lets out nothing but text markup.
import { EDITING_ELEMENT_HANDLE, type EditingElementHandle } from "../editingElement";
import { elementForHandle } from "../editingHandles";
import { isStylableElement, type StylableElement } from "../domRealm";
import { sanitizeRichTextChildren } from "../../utils/richTextSanitize";
import { openTextEdits, isTextMarkup, MAX_EDIT_VALUE } from "./editElement";
import { isEditableText } from "./textMarkup";
import {
  applyInlineStyle,
  INLINE_STYLE_PROPERTIES,
  readFirstPaintedElement,
  readInlineStyle,
  readInlineStyleSpread,
} from "../../utils/inlineTextStyleRead";

type Point = { x: number; y: number };
type Style = Record<string, string | null>;
export type TextEditParams =
  | { handle: EditingElementHandle; action: "start"; caret: Point | null }
  | { handle: EditingElementHandle; action: "end"; keep: boolean }
  | { handle: EditingElementHandle; action: "style"; style: Style };
export type TextEditResult = { applied: boolean; html: string | null; previous: string | null };
/** Posted to the starting port when Enter, Escape or a blur ends the session in the frame; null html was refused. */
export type TextEditEndedEvent = {
  handle: EditingElementHandle;
  html: string | null;
  previous: string;
};

/** The selection in an open session, posted on its port as it changes; null when nothing is selected in it. */
export type TextEditSelection = {
  rect: { x: number; y: number; width: number; height: number };
  viewportWidth: number;
  styles: Record<string, string>;
  colours: string[];
  painted: string | null;
};
export type TextEditSelectionEvent = {
  handle: EditingElementHandle;
  selection: TextEditSelection | null;
};

const EDITING_OUTLINE = "2px solid #3CE6AC";
const MAX_STYLE_VALUE = 256;
const MAX_COLOURS = 16;
const STYLE_VALUES: Record<string, (value: string) => boolean> = {
  color: (value) => value.length <= MAX_STYLE_VALUE,
  "font-weight": (value) => value === "700",
  "font-style": (value) => value === "italic",
  "text-decoration-line": (value) => value === "underline",
};

type Fields = Record<string, unknown>;
const isRecord = (value: unknown): value is Fields =>
  Object.prototype.toString.call(value) === "[object Object]";
const keysAre = (value: Fields, keys: string) => Object.keys(value).sort().join() === keys;
const isHandle = (value: unknown): value is string =>
  typeof value === "string" && EDITING_ELEMENT_HANDLE.test(value);
const isPoint = (value: unknown): value is Point =>
  isRecord(value) && keysAre(value, "x,y") && Number.isFinite(value.x) && Number.isFinite(value.y);

export function parseTextEdit(params: unknown): TextEditParams | null {
  if (!isRecord(params) || !isHandle(params.handle)) return null;
  const { handle, action } = params;
  if (action === "start" && keysAre(params, "action,caret,handle")) {
    const { caret } = params;
    return caret === null || isPoint(caret) ? { handle, action, caret } : null;
  }
  if (action === "end" && keysAre(params, "action,handle,keep") && typeof params.keep === "boolean")
    return { handle, action, keep: params.keep };
  if (action === "style" && keysAre(params, "action,handle,style") && isStyle(params.style))
    return { handle, action, style: params.style };
  return null;
}

const isStyle = (value: unknown): value is Style =>
  isRecord(value) &&
  Object.keys(value).length > 0 &&
  Object.entries(value).every(
    ([key, set]) =>
      Object.hasOwn(STYLE_VALUES, key) &&
      (set === null || (typeof set === "string" && STYLE_VALUES[key]!(set))),
  );
const isShortText = (value: unknown): value is string =>
  typeof value === "string" && value.length <= MAX_STYLE_VALUE;
const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const isRect = (value: unknown) =>
  isRecord(value) &&
  keysAre(value, "height,width,x,y") &&
  Object.values(value).every(isFiniteNumber);
const isShownStyles = (value: unknown) =>
  isRecord(value) &&
  Object.entries(value).every(([key, set]) => Object.hasOwn(STYLE_VALUES, key) && isShortText(set));
const isColours = (value: unknown) =>
  Array.isArray(value) && value.length <= MAX_COLOURS && value.every(isShortText);

function isSelection(value: unknown): value is TextEditSelection {
  if (!isRecord(value) || !keysAre(value, "colours,painted,rect,styles,viewportWidth"))
    return false;
  const { rect, viewportWidth, styles, colours, painted } = value;
  const shown = isFiniteNumber(viewportWidth) && viewportWidth > 0;
  return (
    shown &&
    isRect(rect) &&
    isShownStyles(styles) &&
    isColours(colours) &&
    (painted === null || isShortText(painted))
  );
}

export function textEditSelectionEvent(
  data: unknown,
  version: number,
): TextEditSelectionEvent | null {
  if (!isRecord(data) || !keysAre(data, "event,handle,selection,v")) return null;
  if (data.v !== version || data.event !== "text-edit-selection" || !isHandle(data.handle))
    return null;
  const { handle, selection } = data;
  return selection === null || isSelection(selection) ? { handle, selection } : null;
}

const isValue = (value: unknown) =>
  value === null || (typeof value === "string" && value.length <= MAX_EDIT_VALUE);
const isTextMarkupOrNull = (value: unknown): value is string | null =>
  value === null || (typeof value === "string" && isTextMarkup(value));

export function textEditEndedEvent(data: unknown, version: number): TextEditEndedEvent | null {
  if (!isRecord(data) || !keysAre(data, "event,handle,html,previous,v")) return null;
  if (data.v !== version || data.event !== "text-edit-ended" || !isHandle(data.handle)) return null;
  const { handle, html, previous } = data;
  if (!isValue(html) || typeof previous !== "string" || !isValue(previous)) return null;
  if (!isTextMarkupOrNull(html) || !isTextMarkupOrNull(previous))
    return { handle, html: null, previous: "" };
  return { handle, html, previous };
}

export function textEditResult(reply: unknown): TextEditResult | null {
  if (!isRecord(reply) || !keysAre(reply, "applied,html,previous")) return null;
  const { applied, html, previous } = reply;
  if (typeof applied !== "boolean" || !isTextMarkupOrNull(html) || !isTextMarkupOrNull(previous))
    return null;
  return { applied, html, previous };
}

type Editable = StylableElement & HTMLElement;
interface Session {
  handle: EditingElementHandle;
  element: Editable;
  port: MessagePort;
  original: string;
  outline: string;
  outlineOffset: string;
  stop: () => void;
  report: () => void;
}

let session: Session | null = null;
const NOTHING: TextEditResult = { applied: false, html: null, previous: null };

function clearSelectionWithin(element: Element): void {
  const selection = element.ownerDocument.defaultView?.getSelection();
  if (!selection || selection.rangeCount === 0) return;
  const range = selection.getRangeAt(0);
  if (element.contains(range.startContainer) || element.contains(range.endContainer))
    selection.removeAllRanges();
}

function selectedRange(element: Element): Range | null {
  const selection = element.ownerDocument.defaultView?.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  return element.contains(range.commonAncestorContainer) ? range : null;
}

const shortStyles = (styles: Record<string, string>) =>
  Object.fromEntries(Object.entries(styles).filter(([, value]) => isShortText(value)));

function selectionIn(element: Element): TextEditSelection | null {
  const range = selectedRange(element);
  const view = element.ownerDocument.defaultView;
  if (!range || !view) return null;
  const { left: x, top: y, width, height } = range.getBoundingClientRect();
  const painted = readFirstPaintedElement(range, "color");
  const paintedColour = painted ? view.getComputedStyle(painted).color : null;
  return {
    rect: { x, y, width, height },
    viewportWidth: view.innerWidth || 1,
    styles: shortStyles(readInlineStyle(range, INLINE_STYLE_PROPERTIES)),
    colours: readInlineStyleSpread(range, "color").filter(isShortText).slice(0, MAX_COLOURS),
    painted: isShortText(paintedColour) ? paintedColour : null,
  };
}

function keptMarkup(element: Editable): string | null {
  sanitizeRichTextChildren(element);
  const html = element.innerHTML;
  return isTextMarkup(html) ? html : null;
}

function close(keep: boolean): { html: string | null; previous: string } | null {
  const open = session;
  if (!open) return null;
  session = null;
  open.stop();
  const { element } = open;
  openTextEdits.delete(element);
  const html = keep ? keptMarkup(element) : null;
  if (html === null || !element.isConnected) element.innerHTML = open.original;
  element.removeAttribute("contenteditable");
  element.style.outline = open.outline;
  element.style.outlineOffset = open.outlineOffset;
  if (element.isConnected) {
    clearSelectionWithin(element);
    element.blur();
  }
  return { html, previous: open.original };
}

/** Ends an open session with its original markup back; the agent's dispose and a page hide call it. */
export function endTextEdit(): void {
  close(false);
}

export function caretRangeAt(doc: Document, at: Point): Range | null {
  const legacy = doc as Document & { caretRangeFromPoint?: (x: number, y: number) => Range | null };
  if (typeof legacy.caretRangeFromPoint === "function")
    return legacy.caretRangeFromPoint(at.x, at.y);
  const standard = doc as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  };
  const position = standard.caretPositionFromPoint?.(at.x, at.y);
  if (!position) return null;
  const range = doc.createRange();
  range.setStart(position.offsetNode, position.offset);
  return range;
}

function placeCaret(element: Editable, at: Point | null): void {
  const doc = element.ownerDocument;
  const selection = doc.defaultView?.getSelection();
  if (!selection) return;
  let range = at ? caretRangeAt(doc, at) : null;
  if (!range || !element.contains(range.startContainer)) {
    range = doc.createRange();
    range.selectNodeContents(element);
  }
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

export function takePlainTextOnly(element: HTMLElement): () => void {
  const insertPlainText = (text: string | undefined) => {
    if (text) element.ownerDocument.execCommand("insertText", false, text);
  };
  const onPaste = (event: ClipboardEvent) => {
    event.preventDefault();
    insertPlainText(event.clipboardData?.getData("text/plain"));
  };
  const onDragOver = (event: DragEvent) => event.preventDefault();
  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    insertPlainText(event.dataTransfer?.getData("text/plain"));
  };
  element.addEventListener("paste", onPaste);
  element.addEventListener("dragover", onDragOver);
  element.addEventListener("drop", onDrop);
  return () => {
    element.removeEventListener("paste", onPaste);
    element.removeEventListener("dragover", onDragOver);
    element.removeEventListener("drop", onDrop);
  };
}

function listen(element: Editable, endInFrame: () => void, report: () => void): () => void {
  const onKeyDown = (event: KeyboardEvent) => {
    if ((event.key !== "Enter" || event.shiftKey) && event.key !== "Escape") return;
    event.preventDefault();
    endInFrame();
  };
  const removed = new MutationObserver(() => {
    if (!element.isConnected) endInFrame();
  });
  removed.observe(element.ownerDocument, { childList: true, subtree: true });
  const view = element.ownerDocument.defaultView;
  const releasePlainText = takePlainTextOnly(element);
  element.addEventListener("keydown", onKeyDown);
  element.addEventListener("blur", endInFrame);
  element.ownerDocument.addEventListener("selectionchange", report);
  view?.addEventListener("pagehide", endTextEdit);
  return () => {
    element.ownerDocument.removeEventListener("selectionchange", report);
    releasePlainText();
    element.removeEventListener("keydown", onKeyDown);
    element.removeEventListener("blur", endInFrame);
    view?.removeEventListener("pagehide", endTextEdit);
    removed.disconnect();
  };
}

function start(
  handle: EditingElementHandle,
  caret: Point | null,
  port: MessagePort,
  version: number,
) {
  close(false);
  const element = elementForHandle(handle);
  if (!isStylableElement(element) || !isEditableText(element)) return NOTHING;
  const editable = element as Editable;
  const open: Session = {
    handle,
    element: editable,
    port,
    original: editable.innerHTML,
    outline: editable.style.outline,
    outlineOffset: editable.style.outlineOffset,
    stop: () => {},
    report: () => {
      if (session !== open) return;
      const selection = selectionIn(editable);
      port.postMessage({ v: version, event: "text-edit-selection", handle, selection });
    },
  };
  const endInFrame = () => {
    if (session !== open) return;
    const ended = close(true);
    if (ended) port.postMessage({ v: version, event: "text-edit-ended", handle, ...ended });
  };
  open.stop = listen(editable, endInFrame, open.report);
  session = open;
  openTextEdits.add(editable);
  editable.style.outline = EDITING_OUTLINE;
  editable.style.outlineOffset = "2px";
  editable.setAttribute("contenteditable", "true");
  editable.focus({ preventScroll: true });
  placeCaret(editable, caret);
  return { applied: true, html: null, previous: open.original };
}

export function textEdit(
  params: TextEditParams,
  port: MessagePort,
  version: number,
): TextEditResult {
  if (params.action === "start") return start(params.handle, params.caret, port, version);
  if (session?.handle !== params.handle || session.port !== port) return NOTHING;
  if (params.action === "style") return styleSelection(session, params.style);
  const ended = close(params.keep);
  return ended ? { applied: true, ...ended } : NOTHING;
}

function styleSelection(open: Session, style: Style): TextEditResult {
  const range = selectedRange(open.element);
  if (!range) return NOTHING;
  applyInlineStyle(range, style);
  open.report();
  return { applied: true, html: null, previous: null };
}
