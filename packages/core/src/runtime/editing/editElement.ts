// `edit-element`: a property panel edit drawn live on one element: inline styles and attributes,
// null removing one. The reply carries what each name held before, so a failed save can put it back.
import { EDITING_ELEMENT_HANDLE, type EditingElementHandle } from "../editingElement";
import { elementForHandle } from "../editingHandles";

export type ElementEditEntry = [name: string, value: string | null];
export type EditElementParams = {
  handle: EditingElementHandle;
  styles: ElementEditEntry[];
  attributes: ElementEditEntry[];
};
export type EditElementResult = {
  applied: boolean;
  styles: ElementEditEntry[];
  attributes: ElementEditEntry[];
};

const MAX_ENTRIES = 64;
export const MAX_EDIT_VALUE = 200_000;
const STYLE_NAME = /^(?:[a-z][a-z0-9-]*|--[\w\u0080-￿-]+)$/;
// Event handler attributes are refused: an edit draws what the file will hold, it never runs script.
const ATTRIBUTE_NAME = /^(?!on)[^\s"'>/=]{1,256}$/i;

function entries(value: unknown, name: RegExp): ElementEditEntry[] | null {
  if (!Array.isArray(value) || value.length > MAX_ENTRIES) return null;
  const valid = value.every(
    (entry) =>
      Array.isArray(entry) &&
      entry.length === 2 &&
      typeof entry[0] === "string" &&
      name.test(entry[0]) &&
      (entry[1] === null || (typeof entry[1] === "string" && entry[1].length <= MAX_EDIT_VALUE)),
  );
  return valid ? (value as ElementEditEntry[]) : null;
}

export function parseEditElement(params: unknown): EditElementParams | null {
  if (Object.prototype.toString.call(params) !== "[object Object]") return null;
  const record = params as Record<string, unknown>;
  if (Object.keys(record).sort().join() !== "attributes,handle,styles") return null;
  const { handle } = record;
  if (typeof handle !== "string" || !EDITING_ELEMENT_HANDLE.test(handle)) return null;
  const styles = entries(record.styles, STYLE_NAME);
  const attributes = entries(record.attributes, ATTRIBUTE_NAME);
  return styles && attributes ? { handle, styles, attributes } : null;
}

export function editElement({ handle, styles, attributes }: EditElementParams): EditElementResult {
  const element = elementForHandle(handle);
  if (!(element instanceof HTMLElement) && !(element instanceof SVGElement))
    return { applied: false, styles: [], attributes: [] };
  const style = element.style;
  const before = {
    styles: styles.map(([name]): ElementEditEntry => [name, style.getPropertyValue(name) || null]),
    attributes: attributes.map(([name]): ElementEditEntry => [name, element.getAttribute(name)]),
  };
  for (const [name, value] of styles) {
    if (value === null) style.removeProperty(name);
    else style.setProperty(name, value);
  }
  for (const [name, value] of attributes) {
    if (value === null) element.removeAttribute(name);
    else element.setAttribute(name, value);
  }
  return { applied: true, ...before };
}
