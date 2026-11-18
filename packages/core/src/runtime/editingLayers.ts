/** The Layers walk `layers` answers; Studio walks a frame it scripts by the same rules. */
import { isRichTextFormattingTag } from "../utils/richTextSanitize";
import { isClipHiddenByRuntime } from "../studioPreviewMark";
import { MAX_QUERY_MATCHES, type EditingElementHandle } from "./editingElement";
import { elementForHandle, handleFor } from "./editingHandles";
import { isDomLayerElement } from "./editingTargets";
import { isElementNode } from "./domRealm";

export type LayerKind = "image" | "video" | "audio" | "vector" | "group" | "text" | "shape";

export interface EditingLayer {
  handle: EditingElementHandle;
  depth: number;
  childCount: number;
  zIndex: number;
  kind: LayerKind;
}

export function isCompositionHost(el: Element): boolean {
  return el.hasAttribute("data-composition-src") || el.hasAttribute("data-composition-file");
}

export function hasOnlyFormattingChildren(element: HTMLElement): boolean {
  for (const child of Array.from(element.children)) {
    if (!isRichTextFormattingTag(child.tagName)) return false;
    if (child.namespaceURI !== "http://www.w3.org/1999/xhtml") return false;
    // Formatting nests, and a structural child hidden inside a span is still structural.
    if (!hasOnlyFormattingChildren(child as HTMLElement)) return false;
  }
  return true;
}

/** What a Layers row tells a person an element is: its media tag, a group, text, or else a shape. */
export function layerKindOf(el: Element, hasChildren: boolean): LayerKind {
  const tag = el.tagName.toLowerCase();
  if (tag === "img" || tag === "picture") return "image";
  if (tag === "video") return "video";
  if (tag === "audio") return "audio";
  if (tag === "svg") return "vector";
  if (el.hasAttribute("data-hf-group") || isCompositionHost(el)) return "group";
  if (hasOnlyFormattingChildren(el as HTMLElement) && el.textContent?.trim()) return "text";
  return hasChildren ? "group" : "shape";
}

/** The inline `z-index`, else the computed one; 0 for `auto` or none. */
export function elementZIndex(element: HTMLElement): number {
  const inline = element.style?.zIndex;
  if (inline && inline !== "auto") {
    const parsed = parseInt(inline, 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  const value = element.ownerDocument?.defaultView?.getComputedStyle(element).zIndex;
  if (!value || value === "auto") return 0;
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

const layerChildren = (el: Element) =>
  Array.from(el.children).filter(
    (child) => isElementNode(child) && isDomLayerElement(child as HTMLElement),
  ).length;

/** Every layer under `roots`, in document order, with its depth among layers. */
function walkLayers(
  roots: readonly Element[],
  max = Number.POSITIVE_INFINITY,
): {
  layers: Array<{ element: HTMLElement; depth: number; childCount: number }>;
  truncated: boolean;
} {
  const layers: Array<{ element: HTMLElement; depth: number; childCount: number }> = [];
  let truncated = false;
  const visit = (el: HTMLElement, depth: number) => {
    if (truncated || isClipHiddenByRuntime(el)) return;
    const layer = isDomLayerElement(el);
    if (layer) {
      if (layers.length === max) {
        truncated = true;
        return;
      }
      layers.push({ element: el, depth, childCount: layerChildren(el) });
    }
    for (const child of Array.from(el.children)) {
      if (isElementNode(child)) visit(child as HTMLElement, layer ? depth + 1 : depth);
    }
  };
  for (const root of roots) if (isElementNode(root)) visit(root as HTMLElement, 0);
  return { layers, truncated };
}

/**
 * `layers`: the composition's layers, or the drilled-into group's when `group` names one, from the
 * `offset`th on. A `group` this page no longer has lists nothing, so Studio can leave the drill-in.
 */
export function layersOf(
  group?: EditingElementHandle,
  offset = 0,
): { layers: EditingLayer[]; truncated: boolean; missingGroup: boolean } {
  const scope = group ? elementForHandle(group) : null;
  if (group && !scope) return { layers: [], truncated: false, missingGroup: true };
  const root = document.querySelector("[data-composition-id]") ?? document.documentElement;
  const roots = scope ? Array.from(scope.children) : root ? [root] : [];
  const walk = walkLayers(roots, offset + MAX_QUERY_MATCHES);
  return {
    truncated: walk.truncated,
    missingGroup: false,
    layers: walk.layers.slice(offset).map(({ element, depth, childCount }) => ({
      handle: handleFor(element),
      depth,
      childCount,
      zIndex: elementZIndex(element),
      kind: layerKindOf(element, childCount > 0),
    })),
  };
}
