/** Media elements swapped to their proxy, each with the src attribute it had before the swap. */
export const swappedElements = new WeakMap<Element, string | null>();

export function unproxiedSrc(el: Element): string | null {
  return swappedElements.has(el) ? (swappedElements.get(el) ?? null) : el.getAttribute("src");
}

/** Videos showing a still of their last frame as poster across a copy swap, each with the poster it had before. */
export const heldPosters = new WeakMap<Element, string | null>();

export function unheldPoster(el: Element): string | null {
  return heldPosters.has(el) ? (heldPosters.get(el) ?? null) : el.getAttribute("poster");
}
