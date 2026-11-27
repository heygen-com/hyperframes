// `text-edit`: one in-place text editing session in the frame, for a parent that cannot script it.
// It edits only an element it handed a handle for, and lets out nothing but text markup.
import { postOnPort } from "../runtimePort";
import { EDITING_ELEMENT_HANDLE, type EditingElementHandle } from "../editingElement";
import { elementForHandle } from "../editingHandles";
import { isDomNode, isStylableElement, type StylableElement } from "../domRealm";
import { sanitizeRichTextChildren } from "../../utils/richTextSanitize";
import { openTextEdits, isTextMarkup, MAX_EDIT_VALUE } from "./editElement";
import { isEditableText } from "./textMarkup";
import {
  caretBoxIn,
  caretColorOf,
  caretSideAfterKey,
  placeCaretAtEnd,
  type CaretSide,
} from "./textCaret";
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
  | { handle: EditingElementHandle; action: "start"; caret: Point | null; away?: boolean }
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
export type TextEditCaret = {
  left: number;
  top: number;
  height: number;
  color: string;
  viewportWidth: number;
};
export type TextEditAwayEvent = {
  handle: EditingElementHandle;
  button: 0 | 2;
  point: Point;
  viewportWidth: number;
  keys: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean };
};
export type TextEditSelectionEvent = {
  handle: EditingElementHandle;
  selection: TextEditSelection | null;
  caret: TextEditCaret | null;
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

function parseStart(handle: EditingElementHandle, params: Fields): TextEditParams | null {
  const { caret, away } = params;
  if (caret !== null && !isPoint(caret)) return null;
  if (keysAre(params, "action,caret,handle")) return { handle, action: "start", caret };
  if (keysAre(params, "action,away,caret,handle") && typeof away === "boolean")
    return { handle, action: "start", caret, away };
  return null;
}

export function parseTextEdit(params: unknown): TextEditParams | null {
  if (!isRecord(params) || !isHandle(params.handle)) return null;
  const { handle, action } = params;
  if (action === "start") return parseStart(handle, params);
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

function isCaret(value: unknown): value is TextEditCaret {
  if (!isRecord(value) || !keysAre(value, "color,height,left,top,viewportWidth")) return false;
  const { left, top, height, color, viewportWidth } = value;
  return (
    [left, top, height, viewportWidth].every(isFiniteNumber) &&
    (height as number) >= 0 &&
    (viewportWidth as number) > 0 &&
    isShortText(color)
  );
}

export function textEditSelectionEvent(
  data: unknown,
  version: number,
): TextEditSelectionEvent | null {
  if (!isRecord(data) || !keysAre(data, "caret,event,handle,selection,v")) return null;
  if (data.v !== version || data.event !== "text-edit-selection" || !isHandle(data.handle))
    return null;
  const { handle, selection, caret } = data;
  if (!(selection === null || isSelection(selection))) return null;
  return caret === null || isCaret(caret) ? { handle, selection, caret } : null;
}

const isKeys = (value: unknown): value is TextEditAwayEvent["keys"] =>
  isRecord(value) &&
  keysAre(value, "ctrlKey,metaKey,shiftKey") &&
  Object.values(value).every((flag) => typeof flag === "boolean");

export function textEditAwayEvent(data: unknown, version: number): TextEditAwayEvent | null {
  if (!isRecord(data) || !keysAre(data, "button,event,handle,keys,point,v,viewportWidth"))
    return null;
  if (data.v !== version || data.event !== "text-edit-away" || !isHandle(data.handle)) return null;
  const { handle, button, point, viewportWidth, keys } = data;
  if ((button !== 0 && button !== 2) || !isPoint(point) || !isKeys(keys)) return null;
  if (!isFiniteNumber(viewportWidth) || viewportWidth <= 0) return null;
  return { handle, button, point, viewportWidth, keys };
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
  caretColor: string;
  caret: { color: string; side: CaretSide; composing: boolean };
  stop: () => void;
  report: () => void;
}

let session: Session | null = null;
const NOTHING: TextEditResult = { applied: false, html: null, previous: null };

export function isActiveTextEditTarget(target: EventTarget | null): boolean {
  return Boolean(session && isDomNode(target) && session.element.contains(target));
}

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
  element.style.caretColor = open.caretColor;
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
  const range = at ? caretRangeAt(doc, at) : null;
  if (!range || !element.contains(range.startContainer)) return placeCaretAtEnd(element);
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

function followCaret(element: Editable, open: Session): () => void {
  const view = element.ownerDocument.defaultView;
  const onKey = ({ key }: KeyboardEvent) => {
    open.caret.side = caretSideAfterKey(key, open.caret.side);
  };
  const onPress = () => {
    open.caret.side = "after";
  };
  const composing = (on: boolean) => () => {
    open.caret.composing = on;
    open.report();
  };
  const begin = composing(true);
  const finish = composing(false);
  element.addEventListener("keydown", onKey);
  element.addEventListener("pointerdown", onPress);
  element.addEventListener("input", open.report);
  element.addEventListener("compositionstart", begin);
  element.addEventListener("compositionend", finish);
  view?.addEventListener("resize", open.report);
  view?.addEventListener("scroll", open.report, true);
  return () => {
    element.removeEventListener("keydown", onKey);
    element.removeEventListener("pointerdown", onPress);
    element.removeEventListener("input", open.report);
    element.removeEventListener("compositionstart", begin);
    element.removeEventListener("compositionend", finish);
    view?.removeEventListener("resize", open.report);
    view?.removeEventListener("scroll", open.report, true);
  };
}

function passAway(element: Editable, post: (away: Omit<TextEditAwayEvent, "handle">) => void) {
  const doc = element.ownerDocument;
  const view = doc.defaultView;
  const away = (event: MouseEvent, button: 0 | 2) => ({
    button,
    point: { x: event.clientX, y: event.clientY },
    viewportWidth: view?.innerWidth || 1,
    keys: { shiftKey: event.shiftKey, metaKey: event.metaKey, ctrlKey: event.ctrlKey },
  });
  const afterTheBlurThatSaves = (send: () => void) => view?.setTimeout(send);
  const onPress = (event: PointerEvent) => {
    if (event.button !== 0 || element.contains(event.target as Node)) return;
    const message = away(event, 0);
    afterTheBlurThatSaves(() => post(message));
  };
  const onMenu = (event: MouseEvent) => {
    event.preventDefault();
    post(away(event, 2));
  };
  doc.addEventListener("pointerdown", onPress, true);
  doc.addEventListener("contextmenu", onMenu, true);
  return () => {
    doc.removeEventListener("pointerdown", onPress, true);
    doc.removeEventListener("contextmenu", onMenu, true);
  };
}

function caretOf(open: Session): TextEditCaret | null {
  const box = open.caret.composing ? null : caretBoxIn(open.element, open.caret.side);
  const viewportWidth = open.element.ownerDocument.defaultView?.innerWidth || 1;
  return box && { ...box, color: open.caret.color, viewportWidth };
}

function start(
  handle: EditingElementHandle,
  caret: Point | null,
  hostTakesAway: boolean,
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
    caretColor: editable.style.caretColor,
    caret: { color: caretColorOf(editable), side: "after", composing: false },
    stop: () => {},
    report: () => {
      if (session !== open) return;
      const selection = selectionIn(editable);
      const caret = caretOf(open);
      postOnPort(port, { v: version, event: "text-edit-selection", handle, selection, caret });
    },
  };
  const endInFrame = () => {
    if (session !== open) return;
    const ended = close(true);
    if (ended) postOnPort(port, { v: version, event: "text-edit-ended", handle, ...ended });
  };
  const stopListening = listen(editable, endInFrame, open.report);
  const stopFollowing = followCaret(editable, open);
  const stopPassing = hostTakesAway
    ? passAway(editable, (away) =>
        postOnPort(port, { v: version, event: "text-edit-away", handle, ...away }),
      )
    : () => {};
  open.stop = () => {
    stopListening();
    stopFollowing();
    stopPassing();
  };
  session = open;
  openTextEdits.add(editable);
  editable.style.outline = EDITING_OUTLINE;
  editable.style.outlineOffset = "2px";
  editable.setAttribute("contenteditable", "true");
  // Studio draws the caret at screen size: the browser's own would shrink below a pixel in the scaled preview.
  editable.style.caretColor = "transparent";
  editable.focus({ preventScroll: true });
  placeCaret(editable, caret);
  return { applied: true, html: null, previous: open.original };
}

export function textEdit(
  params: TextEditParams,
  port: MessagePort,
  version: number,
): TextEditResult {
  if (params.action === "start")
    return start(params.handle, params.caret, params.away === true, port, version);
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
