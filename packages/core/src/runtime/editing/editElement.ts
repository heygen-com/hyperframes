// `edit-element`: a property panel edit drawn live on one element: inline styles and attributes,
// null removing one. The reply carries what each name held before, so a failed save can put it back.
import { EDITING_ELEMENT_HANDLE, type EditingElementHandle } from "../editingElement";
import { elementForHandle } from "../editingHandles";
import { isStylableElement } from "../domRealm";

export type ElementEditEntry = [name: string, value: string | null];
export type StyleEditEntry = [name: string, value: string | null, priority?: "important"];
export type EditElementParams = {
  handle: EditingElementHandle;
  styles: StyleEditEntry[];
  attributes: ElementEditEntry[];
};
export type EditElementResult = {
  applied: boolean;
  styles: StyleEditEntry[];
  attributes: ElementEditEntry[];
};

export const MAX_EDIT_ENTRIES = 64;
export const MAX_EDIT_VALUE = 200_000;
const STYLE_NAME = /^(?:-?[a-z][a-z0-9-]*|--[\w\u0080-\uffff-]+)$/;
const DATA_ATTRIBUTE = /^data-[a-z0-9_-]+$/;
const PANEL_ATTRIBUTES = new Set(["loop", "muted", "alt", "title", "src"]);
const MEDIA_TAGS = new Set(["img", "video", "audio"]);

const isAttributeName = (name: string) => DATA_ATTRIBUTE.test(name) || PANEL_ATTRIBUTES.has(name);
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
  if (Object.keys(record).sort().join() !== "attributes,handle,styles") return null;
  const { handle } = record;
  if (typeof handle !== "string" || !EDITING_ELEMENT_HANDLE.test(handle)) return null;
  const styles = entries<StyleEditEntry>(record.styles, styleEntry);
  const attributes = entries<ElementEditEntry>(record.attributes, attributeEntry);
  return styles && attributes ? { handle, styles, attributes } : null;
}

const NOT_APPLIED: EditElementResult = { applied: false, styles: [], attributes: [] };

/** Draws nothing it could not put back: a `src` off media, or a value too long to send back. */
export function editElement({ handle, styles, attributes }: EditElementParams): EditElementResult {
  const element = elementForHandle(handle);
  if (!isStylableElement(element)) return NOT_APPLIED;
  const style = element.style;
  const media = MEDIA_TAGS.has(element.localName);
  if (attributes.some(([name]) => name === "src") && !media) return NOT_APPLIED;
  const before: EditElementResult = {
    applied: true,
    styles: styles.map(([name]): StyleEditEntry => {
      const value = style.getPropertyValue(name) || null;
      return style.getPropertyPriority(name) ? [name, value, "important"] : [name, value];
    }),
    attributes: attributes.map(([name]): ElementEditEntry => [name, element.getAttribute(name)]),
  };
  if (![...before.styles, ...before.attributes].every(([, value]) => isValue(value)))
    return NOT_APPLIED;
  for (const [name, value, priority] of styles) {
    if (value === null) style.removeProperty(name);
    else style.setProperty(name, value, priority ?? "");
  }
  for (const [name, value] of attributes) {
    if (value === null) element.removeAttribute(name);
    else element.setAttribute(name, value);
  }
  return before;
}
