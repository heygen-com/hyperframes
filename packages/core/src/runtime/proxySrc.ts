// Elements already swapped to their proxy src, each mapped to the src attribute it had before. Gates
// every proxy trigger so a second undecodable-video signal never re-swaps or loops.
export const swappedElements = new WeakMap<Element, string | null>();

/** The element's src attribute as it was before any proxy swap. */
export function unproxiedSrc(el: Element): string | null {
  return swappedElements.has(el) ? (swappedElements.get(el) ?? null) : el.getAttribute("src");
}
