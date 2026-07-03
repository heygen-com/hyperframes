// fallow-ignore-next-line complexity
export function parseStyleDecls(style: string): { props: Map<string, string>; order: string[] } {
  const props = new Map<string, string>();
  const order: string[] = [];
  let i = 0;
  while (i < style.length) {
    let depth = 0;
    let inSingle = false;
    let inDouble = false;
    const start = i;
    while (i < style.length) {
      const ch = style[i];
      if (ch === "'" && !inDouble) inSingle = !inSingle;
      else if (ch === '"' && !inSingle) inDouble = !inDouble;
      else if (!inSingle && !inDouble) {
        if (ch === "(") depth++;
        else if (ch === ")") depth = Math.max(0, depth - 1);
        else if (ch === ";" && depth === 0) break;
      }
      i++;
    }
    const decl = style.slice(start, i).trim();
    i++;
    if (!decl) continue;
    const colon = decl.indexOf(":");
    if (colon < 0) continue;
    const key = decl.slice(0, colon).trim();
    const val = decl.slice(colon + 1).trim();
    if (!key) continue;
    if (!props.has(key)) order.push(key);
    props.set(key, val);
  }
  return { props, order };
}

function serializeStyleDecls(props: Map<string, string>, order: string[]): string {
  return order
    .map((k) => `${k}: ${props.get(k) ?? ""}`)
    .filter((d) => d.trim())
    .join("; ");
}

export function patchStyleAttrString(
  style: string,
  property: string,
  value: string | null,
): string {
  const { props, order } = parseStyleDecls(style);
  if (value === null) {
    props.delete(property);
    const idx = order.indexOf(property);
    if (idx >= 0) order.splice(idx, 1);
  } else {
    if (!props.has(property)) order.push(property);
    props.set(property, value);
  }
  return serializeStyleDecls(props, order);
}
