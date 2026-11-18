// `text-edit`: one in-place text editing session in the frame, for a parent that cannot script it.
// It edits only an element it handed a handle for, and lets out nothing but text markup.
import { EDITING_ELEMENT_HANDLE, type EditingElementHandle } from "../editingElement";
import { elementForHandle } from "../editingHandles";
import { isStylableElement, type StylableElement } from "../domRealm";
import { sanitizeRichTextChildren } from "../../utils/richTextSanitize";
import { isTextMarkup, MAX_EDIT_VALUE } from "./editElement";

type Point = { x: number; y: number };
export type TextEditParams =
  | { handle: EditingElementHandle; action: "start"; caret: Point | null }
  | { handle: EditingElementHandle; action: "end"; keep: boolean };
export type TextEditResult = { applied: boolean; html: string | null; previous: string | null };
/** Posted to the starting port when Enter, Escape or a blur ends the session in the frame; null html was refused. */
export type TextEditEndedEvent = {
  handle: EditingElementHandle;
  html: string | null;
  previous: string;
};

const EDITING_OUTLINE = "2px solid #3CE6AC";

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
  return null;
}

const isMarkupOrNull = (value: unknown) =>
  value === null || (typeof value === "string" && value.length <= MAX_EDIT_VALUE);

export function textEditEndedEvent(data: unknown, version: number): TextEditEndedEvent | null {
  if (!isRecord(data) || !keysAre(data, "event,handle,html,previous,v")) return null;
  if (data.v !== version || data.event !== "text-edit-ended" || !isHandle(data.handle)) return null;
  const { handle, html, previous } = data;
  if (!isMarkupOrNull(html) || typeof previous !== "string" || !isMarkupOrNull(previous))
    return null;
  return { handle, html: html as string | null, previous };
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
  const html = keep && element.isConnected ? keptMarkup(element) : null;
  if (html === null) element.innerHTML = open.original;
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

function listen(element: Editable, endInFrame: () => void): () => void {
  const onKeyDown = (event: KeyboardEvent) => {
    if ((event.key !== "Enter" || event.shiftKey) && event.key !== "Escape") return;
    event.preventDefault();
    endInFrame();
  };
  const removed = new MutationObserver(() => {
    if (!element.isConnected) close(false);
  });
  removed.observe(element.ownerDocument, { childList: true, subtree: true });
  const view = element.ownerDocument.defaultView;
  const releasePlainText = takePlainTextOnly(element);
  element.addEventListener("keydown", onKeyDown);
  element.addEventListener("blur", endInFrame);
  view?.addEventListener("pagehide", endTextEdit);
  return () => {
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
  if (!isStylableElement(element) || !isTextMarkup(element.innerHTML)) return NOTHING;
  const editable = element as Editable;
  const open: Session = {
    handle,
    element: editable,
    port,
    original: editable.innerHTML,
    outline: editable.style.outline,
    outlineOffset: editable.style.outlineOffset,
    stop: () => {},
  };
  open.stop = listen(editable, () => {
    if (session !== open) return;
    const ended = close(true);
    if (ended) port.postMessage({ v: version, event: "text-edit-ended", handle, ...ended });
  });
  session = open;
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
  const ended = close(params.keep);
  return ended ? { applied: true, ...ended } : NOTHING;
}
