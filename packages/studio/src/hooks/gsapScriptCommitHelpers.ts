import type { DomEditSelection } from "../components/editor/domEditingTypes";

export const PROPERTY_DEFAULTS: Record<string, number> = {
  opacity: 1,
  x: 0,
  y: 0,
  scale: 1,
  scaleX: 1,
  scaleY: 1,
  rotation: 0,
  width: 100,
  height: 100,
};

export function ensureElementAddressable(selection: DomEditSelection): {
  selector: string;
  autoId?: string;
} {
  if (selection.id) return { selector: `#${selection.id}` };
  if (selection.selector) return { selector: selection.selector };

  const el = selection.element;
  const doc = el.ownerDocument;
  const tag = el.tagName.toLowerCase();
  let id = tag;
  let n = 1;
  while (doc.getElementById(id)) {
    n += 1;
    id = `${tag}-${n}`;
  }
  el.setAttribute("id", id);
  return { selector: `#${id}`, autoId: id };
}
