/**
 * GSAP access through an ELEMENT'S OWN window (the preview iframe's runtime),
 * not the studio window. This is the single way studio gesture code touches an
 * iframe element's GSAP position outside the commit pipeline — the resize
 * anchor pin (apply + restore) and the post-commit live correction. The commit
 * pipeline itself stays the owner of persisted values.
 */
type ElementGsapWindow = Window & {
  gsap?: {
    set?: (target: Element, vars: Record<string, number>) => void;
    getProperty?: (target: Element, prop: string) => unknown;
  };
};

function gsapOf(element: HTMLElement): ElementGsapWindow["gsap"] | undefined {
  return (element.ownerDocument.defaultView as ElementGsapWindow | null)?.gsap;
}

/** Set the element's GSAP x/y. Returns false when no runtime is reachable. */
export function setElementGsapPosition(element: HTMLElement, x: number, y: number): boolean {
  const gsap = gsapOf(element);
  if (!gsap?.set) return false;
  gsap.set(element, { x, y });
  return true;
}

/** The element's GSAP numeric property, or null when unreadable. */
export function readElementGsapNumber(element: HTMLElement, prop: string): number | null {
  const value = Number(gsapOf(element)?.getProperty?.(element, prop));
  return Number.isFinite(value) ? value : null;
}
