import type { DomEditSelection } from "./domEditingTypes";

/**
 * Build the "live preview" callback the 3D-transform sub-view fires while a
 * value is being dragged: apply a gsap.set() to the matching node inside the
 * preview iframe so the edit is reflected immediately, before it's committed.
 *
 * Extracted so the identical closure exists once — shared by the legacy
 * PropertyPanel Layout section and the flat Layout group (PropertyPanelFlat).
 */
// Resolve by id when unique, otherwise by selector + selectorIndex — a bare
// querySelector(selector) always hits the FIRST match, so dragging on the
// second of two same-selector siblings would animate the wrong element.
function resolvePreviewNode(
  doc: Document | null | undefined,
  el: DomEditSelection,
): Element | null {
  if (!doc) return null;
  if (el.id) return doc.querySelector(`#${el.id}`);
  if (!el.selector) return null;
  return doc.querySelectorAll(el.selector)[el.selectorIndex ?? 0] ?? null;
}

export function createGsapLivePreview(iframeRef: { readonly current: HTMLIFrameElement | null }) {
  return (el: DomEditSelection, props: Record<string, number>) => {
    const iframe = iframeRef.current;
    const win = iframe?.contentWindow as
      | { gsap?: { set: (t: Element, v: Record<string, number>) => void } }
      | null
      | undefined;
    const node = resolvePreviewNode(iframe?.contentDocument, el);
    if (win?.gsap && node) win.gsap.set(node, props);
  };
}
