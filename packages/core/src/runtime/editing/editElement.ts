// `edit-element`: a property panel edit drawn live on one element: inline styles and attributes,
// null removing one. The reply carries what each name held before, so a failed save can put it back.
import { EDITING_ELEMENT_HANDLE, type EditingElementHandle } from "../editingElement";
import { elementForHandle } from "../editingHandles";
import { isStylableElement, type StylableElement } from "../domRealm";

export type ElementEditEntry = [name: string, value: string | null];
export type StyleEditEntry = [name: string, value: string | null, priority?: "important"];
export type EditElementParams = {
  handle: EditingElementHandle;
  styles: StyleEditEntry[];
  attributes: ElementEditEntry[];
  html?: string;
};
export type EditElementResult = {
  applied: boolean;
  styles: StyleEditEntry[];
  attributes: ElementEditEntry[];
  html?: string;
};

export const MAX_EDIT_ENTRIES = 64;
export const MAX_EDIT_VALUE = 200_000;
const STYLE_NAME = /^(?:-?[a-z][a-z0-9-]*|--[\w\u0080-￿-]+)$/;
const DATA_ATTRIBUTE = /^data-[a-z0-9_-]+$/;
const PANEL_ATTRIBUTES = new Set(["loop", "muted", "alt", "title", "src"]);
const MEDIA_TAGS = new Set(["img", "video", "audio"]);

const isAttributeName = (name: string) => DATA_ATTRIBUTE.test(name) || PANEL_ATTRIBUTES.has(name);
const TEXT_TAGS = new Set([
  "span",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "s",
  "br",
  "sub",
  "sup",
  "small",
]);
const TEXT_ATTRIBUTES = new Set(["class", "id", "style", "title", "lang", "dir"]);

/** Markup a text field writes: text in inline text tags, no URL, no handler. */
function isTextMarkup(html: string): boolean {
  if (html.length > MAX_EDIT_VALUE) return false;
  const holder = document.createElement("template");
  holder.innerHTML = html;
  return Array.from(holder.content.querySelectorAll("*")).every(
    (el) =>
      TEXT_TAGS.has(el.localName) &&
      el
        .getAttributeNames()
        .every((name) => TEXT_ATTRIBUTES.has(name) || DATA_ATTRIBUTE.test(name)),
  );
}
const isValue = (value: unknown) =>
  value === null || (typeof value === "string" && value.length <= MAX_EDIT_VALUE);

function entries<T>(value: unknown, valid: (entry: unknown[]) => boolean): T[] | null {
  if (!Array.isArray(value) || value.length > MAX_EDIT_ENTRIES) return null;
  const ok = value.every((entry) => Array.isArray(entry) && valid(entry));
  return ok ? (value as T[]) : null;
}

const styleEntry = ([name, value, priority, ...rest]: unknown[]) =>
  typeof name === "string" &&
  STYLE_NAME.test(name) &&
  isValue(value) &&
  (priority === undefined || priority === "important") &&
  rest.length === 0;

const attributeEntry = ([name, value, ...rest]: unknown[]) =>
  typeof name === "string" && isAttributeName(name) && isValue(value) && rest.length === 0;

export function parseEditElement(params: unknown): EditElementParams | null {
  if (Object.prototype.toString.call(params) !== "[object Object]") return null;
  const record = params as Record<string, unknown>;
  const keys = Object.keys(record).sort().join();
  if (keys !== "attributes,handle,styles" && keys !== "attributes,handle,html,styles") return null;
  const { handle, html } = record;
  if (typeof handle !== "string" || !EDITING_ELEMENT_HANDLE.test(handle)) return null;
  if (html !== undefined && (typeof html !== "string" || html.length > MAX_EDIT_VALUE)) return null;
  const styles = entries<StyleEditEntry>(record.styles, styleEntry);
  const attributes = entries<ElementEditEntry>(record.attributes, attributeEntry);
  if (!styles || !attributes) return null;
  return html === undefined ? { handle, styles, attributes } : { handle, styles, attributes, html };
}

const NOT_APPLIED: EditElementResult = { applied: false, styles: [], attributes: [] };

function refused(element: StylableElement, attributes: ElementEditEntry[], html?: string) {
  if (attributes.some(([name]) => name === "src") && !MEDIA_TAGS.has(element.localName))
    return true;
  return html !== undefined && !(isTextMarkup(element.innerHTML) && isTextMarkup(html));
}

function valuesBefore(
  element: StylableElement,
  { styles, attributes, html }: EditElementParams,
): EditElementResult {
  const style = element.style;
  return {
    applied: true,
    styles: styles.map(([name]): StyleEditEntry => {
      const value = style.getPropertyValue(name) || null;
      return style.getPropertyPriority(name) ? [name, value, "important"] : [name, value];
    }),
    attributes: attributes.map(([name]): ElementEditEntry => [name, element.getAttribute(name)]),
    ...(html !== undefined && { html: element.innerHTML }),
  };
}

function draw(element: StylableElement, { styles, attributes, html }: EditElementParams) {
  for (const [name, value, priority] of styles) {
    if (value === null) element.style.removeProperty(name);
    else element.style.setProperty(name, value, priority ?? "");
  }
  for (const [name, value] of attributes) {
    if (value === null) element.removeAttribute(name);
    else element.setAttribute(name, value);
  }
  if (html !== undefined) element.innerHTML = html;
}

/** Draws nothing it could not put back: `src` off media, a too-long value, or non-text markup. */
export function editElement(params: EditElementParams): EditElementResult {
  const element = elementForHandle(params.handle);
  if (!isStylableElement(element) || refused(element, params.attributes, params.html))
    return NOT_APPLIED;
  const before = valuesBefore(element, params);
  if (![...before.styles, ...before.attributes].every(([, value]) => isValue(value)))
    return NOT_APPLIED;
  draw(element, params);
  return before;
}
