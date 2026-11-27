import { MAX_ELEMENT_TEXT, MAX_ELEMENT_VALUE, type EditingRect } from "../editingElement";

export const MAX_STAGE_ITEMS = 2_000;
export const MAX_STAGE_CLIP_KEYS = 8;

export interface StageMeasureParams {
  maxItems?: number;
}

export interface StageTextStart {
  x: number;
  y: number;
}

export interface StageMeasuredItem {
  key: string;
  hfId: string | null;
  id: string | null;
  tag: string;
  parent: string | null;
  text: string;
  box: EditingRect;
  fontSize: string;
  color: string;
  background: string;
  placed: boolean;
  visible: boolean;
  clipKeys: string[];
  hasElementChildren: boolean;
  textStart: StageTextStart | null;
  hasBackgroundImage: boolean;
}

export interface StageMeasureResult {
  items: StageMeasuredItem[];
  truncated: boolean;
}

const SKIPPED = new Set(["SCRIPT", "STYLE", "TEMPLATE", "NOSCRIPT", "LINK", "META"]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Object.prototype.toString.call(value) === "[object Object]";

export function parseStageMeasureParams(params: unknown): StageMeasureParams | null {
  if (params === undefined) return {};
  if (!isRecord(params)) return null;
  const keys = Object.keys(params);
  if (keys.length === 0) return {};
  if (keys.length !== 1 || keys[0] !== "maxItems") return null;
  const { maxItems } = params;
  if (typeof maxItems !== "number" || !Number.isSafeInteger(maxItems)) return null;
  if (maxItems < 1 || maxItems > MAX_STAGE_ITEMS) return null;
  return { maxItems };
}

const clampValue = (text: string) => text.slice(0, MAX_ELEMENT_VALUE);
const finite = (value: number) => (Number.isFinite(value) ? value : 0);

function ownText(element: Element): { text: string; nodes: Node[] } {
  const nodes: Node[] = [];
  let raw = "";
  for (let i = 0; i < element.childNodes.length; i += 1) {
    const node = element.childNodes[i];
    if (node && node.nodeType === 3) {
      nodes.push(node);
      raw += node.textContent ?? "";
    }
  }
  return { text: raw.replace(/\s+/g, " ").trim().slice(0, MAX_ELEMENT_TEXT), nodes };
}

const validTextBox = (rect: DOMRect | undefined): rect is DOMRect =>
  Boolean(
    rect && rect.width > 0 && [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite),
  );

function textStartOf(doc: Document, nodes: readonly Node[]): StageTextStart | null {
  const first = nodes[0];
  const last = nodes[nodes.length - 1];
  if (!first || !last) return null;
  try {
    const range = doc.createRange();
    range.setStart(first, 0);
    range.setEnd(last, (last.textContent ?? "").length);
    const rect = range.getBoundingClientRect?.();
    return validTextBox(rect) ? { x: rect.x, y: rect.y + rect.height / 2 } : null;
  } catch {
    return null;
  }
}

function clipKeysOf(element: Element): string[] {
  const clip = element.closest(".clip");
  if (!clip) return [];
  const owner = clip.parentElement?.closest("[data-composition-id]");
  const file = clampValue(
    owner?.getAttribute("data-composition-file") ??
      owner?.getAttribute("data-composition-src") ??
      "index.html",
  );
  const seen = new Set<string>();
  const keys: string[] = [];
  for (const id of [clip.id, clip.getAttribute("data-hf-id")]) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    keys.push(clampValue(`${file}#${id}`));
    if (keys.length >= MAX_STAGE_CLIP_KEYS) break;
  }
  return keys;
}

function isElementVisible(element: Element, style: CSSStyleDeclaration, width: number): boolean {
  if (width <= 0) return false;
  if (typeof element.checkVisibility === "function") {
    return element.checkVisibility({ visibilityProperty: true, opacityProperty: true });
  }
  return style.visibility !== "hidden" && style.display !== "none" && style.opacity !== "0";
}

function measureElement(
  doc: Document,
  view: Window,
  element: Element,
  parent: string | null,
  key: string,
  hfId: string | null,
): StageMeasuredItem {
  const rect = element.getBoundingClientRect();
  const box: EditingRect = {
    x: finite(rect.x),
    y: finite(rect.y),
    width: finite(rect.width),
    height: finite(rect.height),
  };
  const style = view.getComputedStyle(element);
  const { text, nodes } = ownText(element);
  const bgImage = style.backgroundImage;
  return {
    key,
    hfId,
    id: element.id ? clampValue(element.id) : null,
    tag: clampValue(element.tagName.toLowerCase()),
    parent,
    text,
    box,
    fontSize: clampValue(style.fontSize ?? ""),
    color: clampValue(style.color ?? ""),
    background: clampValue(style.backgroundColor ?? ""),
    placed: style.position === "absolute" || style.position === "fixed",
    visible: isElementVisible(element, style, box.width),
    clipKeys: clipKeysOf(element),
    hasElementChildren: element.children.length > 0,
    textStart: text ? textStartOf(doc, nodes) : null,
    hasBackgroundImage: Boolean(bgImage && bgImage !== "none"),
  };
}

export function paintedOnStage(element: Element): boolean {
  const view = element.ownerDocument.defaultView;
  if (!view) return false;
  return isElementVisible(
    element,
    view.getComputedStyle(element),
    element.getBoundingClientRect().width,
  );
}

const escapedIdKey = (hfId: string) => `#${hfId.replace(/[\\>]/g, "\\$&")}`;

function unescapedKeyParts(key: string): string[] {
  const parts = [""];
  for (let i = 0; i < key.length; i += 1) {
    const c = key[i]!;
    if (c === "\\") parts[parts.length - 1] += key[++i] ?? "";
    else if (c === ">") parts.push("");
    else parts[parts.length - 1] += c;
  }
  return parts;
}

export function locateStageKey(
  doc: Document,
  target: { key: string; hfId: string | null },
): Element | null {
  const byId = (id: string) => doc.querySelector(`[data-hf-id="${CSS.escape(id)}"]`);
  if (target.hfId) return byId(target.hfId);
  const [anchor = "", ...steps] = unescapedKeyParts(target.key);
  let element: Element | null = null;
  if (anchor.startsWith("#")) element = byId(anchor.slice(1));
  else if (/^\d+$/.test(anchor)) element = doc.body?.children[Number(anchor)] ?? null;
  for (const step of steps) element = element?.children[Number(step)] ?? null;
  return element;
}

/** Walks `doc.body` in document order up to `maxItems`, capturing layout, styles, visibility, and clip keys. */
export function measureStageDocument(
  doc: Document = document,
  maxItems = MAX_STAGE_ITEMS,
): StageMeasureResult {
  const view = doc.defaultView;
  if (!view || !doc.body) return { items: [], truncated: false };
  const requested = Number.isFinite(maxItems) ? Math.floor(maxItems) : MAX_STAGE_ITEMS;
  const limit = Math.min(Math.max(1, requested), MAX_STAGE_ITEMS);
  const items: StageMeasuredItem[] = [];
  let truncated = false;

  const visit = (element: Element, parent: string | null, path: string) => {
    if (SKIPPED.has(element.tagName.toUpperCase())) return;
    if (items.length >= limit) {
      truncated = true;
      return;
    }
    const rawHfId = element.getAttribute("data-hf-id");
    const hfId = rawHfId ? clampValue(rawHfId) : null;
    const key = clampValue(hfId ? escapedIdKey(hfId) : path);
    items.push(measureElement(doc, view, element, parent, key, hfId));
    for (let i = 0; i < element.children.length; i += 1) {
      const child = element.children[i];
      if (child) visit(child, key, `${key}>${i}`);
      if (truncated) return;
    }
  };

  for (let i = 0; i < doc.body.children.length; i += 1) {
    const child = doc.body.children[i];
    if (child) visit(child, null, `${i}`);
    if (truncated) break;
  }
  return { items, truncated };
}
