/** A translate's parts, split at the spaces outside brackets: Studio's own is `var(--hf-studio-offset-x, 0px) ...`. */
function valueParts(value: string): string[] {
  const parts: string[] = [];
  let [depth, start] = [0, 0];
  for (let i = 0; i <= value.length; i++) {
    const c = value[i];
    if (c === "(") depth += 1;
    else if (c === ")") depth -= 1;
    else if ((c === undefined || c === " ") && depth === 0) {
      if (i > start) parts.push(value.slice(start, i));
      start = i + 1;
    }
  }
  return parts;
}

/** The element's own inline translate (a Studio manual offset is one) moved by `dx dy`, not replaced. */
export function translateBy(own: string, dx: number, dy: number): string {
  if (!own || own === "none") return `${dx}px ${dy}px`;
  const [x = "0px", y = "0px", ...z] = valueParts(own);
  return [`calc(${x} + ${dx}px)`, `calc(${y} + ${dy}px)`, ...z].join(" ");
}

/** The element's own scale (inline, else its stylesheet's) grown by `k`, not replaced. */
export function scaleBy(own: string, k: number): string {
  if (!own || own === "none") return String(k);
  return valueParts(own)
    .map((part) => `calc(${part} * ${k})`)
    .join(" ");
}

/** The element's own rotate (inline, else its stylesheet's) turned `deg` further; a rotate about an axis is kept. */
export function rotateBy(own: string, deg: number): string {
  if (!own || own === "none") return `${deg}deg`;
  return /^-?[\d.]+deg$/.test(own) ? `calc(${own} + ${deg}deg)` : own;
}
