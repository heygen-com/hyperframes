import type { StructureNode } from "@hyperframes/parsers";

/** A DOM element as the parsers' structural node, keeping the element for timing lookups. */
export interface DomNode extends StructureNode<DomNode> {
  el: Element;
}

export function toDomNode(el: Element): DomNode {
  const attrs: Record<string, string | undefined> = {};
  for (const { name, value } of Array.from(el.attributes)) attrs[name] = value;
  return { tag: el.tagName, attrs, children: Array.from(el.children).map(toDomNode), el };
}
