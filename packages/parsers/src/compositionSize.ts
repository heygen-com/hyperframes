import { parseHTML } from "./linkedom.js";

/** The size the renderer compiles a composition at: each side 1080×1920 when its root leaves it unset. */
export function compositionRootSize(root: Element | null): { width: number; height: number } {
  if (!root) return { width: 1080, height: 1920 };
  return {
    width: parseInt(root.getAttribute("data-width") || "1080", 10),
    height: parseInt(root.getAttribute("data-height") || "1920", 10),
  };
}

export const renderedCompositionSize = (html: string) =>
  compositionRootSize(parseHTML(html).document.querySelector("[data-composition-id]"));
