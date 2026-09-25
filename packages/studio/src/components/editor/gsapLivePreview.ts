import type { DomEditSelection } from "./domEditingTypes";
import { findElementForSelection } from "./domEditingElement";

/**
 * Build the "live preview" callback the 3D-transform sub-view fires while a
 * value is being dragged: apply a gsap.set() to the matching node inside the
 * preview iframe so the edit is reflected immediately, before it's committed.
 *
 * Extracted so the identical closure exists once — shared by the legacy
 * PropertyPanel Layout section and the flat Layout group (PropertyPanelFlat).
 */
// The selected node while it is still mounted; after a reload, the copy in the selection's own file (hf-ids and ids
// repeat across flattened sub-compositions), then anywhere.
export function findPreviewNode(
  doc: Document | null | undefined,
  el: DomEditSelection,
): Element | null {
  if (!doc) return null;
  if (el.element?.isConnected && el.element.ownerDocument === doc) return el.element;
  return (
    findElementForSelection(doc, el) ??
    findElementForSelection(doc, { ...el, sourceFile: undefined })
  );
}

export function createGsapLivePreview(iframeRef: { readonly current: HTMLIFrameElement | null }) {
  return (el: DomEditSelection, props: Record<string, number>) => {
    const iframe = iframeRef.current;
    const win = iframe?.contentWindow as
      | { gsap?: { set: (t: Element, v: Record<string, number>) => void } }
      | null
      | undefined;
    const node = findPreviewNode(iframe?.contentDocument, el);
    if (win?.gsap && node) win.gsap.set(node, props);
  };
}
