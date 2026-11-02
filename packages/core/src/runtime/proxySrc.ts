/** Media elements swapped to their proxy, each with the src attribute it had before the swap. */
export const swappedElements = new WeakMap<Element, string | null>();

export function unproxiedSrc(el: Element): string | null {
  return swappedElements.has(el) ? (swappedElements.get(el) ?? null) : el.getAttribute("src");
}

/** Videos showing a still of their last frame as poster across a copy swap: the poster they had before, and when. */
export const heldPosters = new WeakMap<Element, { poster: string | null; since: number }>();

export function unheldPoster(el: Element): string | null {
  return heldPosters.has(el) ? (heldPosters.get(el)?.poster ?? null) : el.getAttribute("poster");
}

const STILL_STANDS_IN_MS = 2000;

/** The video shows a still while its new copy loads, so the film need not wait for it. */
export function stillStandsIn(el: Element): boolean {
  const held = heldPosters.get(el);
  return held !== undefined && performance.now() - held.since < STILL_STANDS_IN_MS;
}
