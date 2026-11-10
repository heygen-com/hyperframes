/** Media elements swapped to their proxy, each with the src attribute it had before the swap. */
export const swappedElements = new WeakMap<Element, string | null>();

/** Media elements the runtime opened at their in-point: the src the author wrote and the one written in its
 * place, null while the clip is held with no src until it is due. */
const openedAtInPoint = new WeakMap<Element, { authored: string; written: string | null }>();

export function recordOpenedAtInPoint(el: Element, authored: string, written: string | null): void {
  openedAtInPoint.set(el, { authored, written });
}

/** True while the src is still the one the runtime wrote: a script or binding that sets another ends it. */
export function isOpenedAtInPoint(el: Element): boolean {
  const record = openedAtInPoint.get(el);
  return record !== undefined && record.written === el.getAttribute("src");
}

/** True while the runtime holds the clip with no src. */
export function isHeldUntilDue(el: Element): boolean {
  return isOpenedAtInPoint(el) && openedAtInPoint.get(el)!.written === null;
}

/** The src the author wrote for a clip the runtime opened or holds. */
export function authoredSrcOf(el: Element): string | null {
  return openedAtInPoint.get(el)?.authored ?? null;
}

export function unproxiedSrc(el: Element): string | null {
  if (swappedElements.has(el)) return swappedElements.get(el) ?? null;
  return isOpenedAtInPoint(el) ? openedAtInPoint.get(el)!.authored : el.getAttribute("src");
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
