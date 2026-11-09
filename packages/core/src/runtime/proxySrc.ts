/** Media elements swapped to their proxy, each with the src attribute it had before the swap. */
export const swappedElements = new WeakMap<Element, string | null>();

/** Media elements whose src is held back until the clip is near, each with the src the author wrote. */
const heldBackSrc = new WeakMap<Element, string>();

export function holdBackSrc(el: Element, src: string): void {
  heldBackSrc.set(el, src);
}

export function isSrcHeldBack(el: Element): boolean {
  return heldBackSrc.has(el);
}

/** The held-back src, forgotten: the caller puts it back on the element. */
export function takeHeldBackSrc(el: Element): string | null {
  const src = heldBackSrc.get(el) ?? null;
  heldBackSrc.delete(el);
  return src;
}

export function unproxiedSrc(el: Element): string | null {
  if (swappedElements.has(el)) return swappedElements.get(el) ?? null;
  return heldBackSrc.get(el) ?? el.getAttribute("src");
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
