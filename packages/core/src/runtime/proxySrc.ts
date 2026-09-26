/** Media elements swapped to their proxy, each with the src attribute it had before the swap. */
export const swappedElements = new WeakMap<Element, string | null>();

export function unproxiedSrc(el: Element): string | null {
  return swappedElements.has(el) ? (swappedElements.get(el) ?? null) : el.getAttribute("src");
}
