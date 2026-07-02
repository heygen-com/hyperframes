// ponytail: queries DOM by exact attribute match without interpolating
// the value into a selector string — zero injection surface.
export function queryByAttr(
  root: ParentNode,
  attr: string,
  value: string,
  tag?: string,
): Element | null {
  const selector = tag ? `${tag}[${attr}]` : `[${attr}]`;
  for (const el of root.querySelectorAll(selector)) {
    if (el.getAttribute(attr) === value) return el;
  }
  return null;
}
