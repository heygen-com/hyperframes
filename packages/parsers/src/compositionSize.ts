import { parseHTML } from "./linkedom.js";

/** The size the renderer compiles a composition at: its root's `data-width` and `data-height`, each side
 * 1080×1920 when unset or when there is no root. Callers that pick an output size read this, never their own rule. */
export function compositionRootSize(root: Element | null): { width: number; height: number } {
  if (!root) return { width: 1080, height: 1920 };
  return {
    width: parseInt(root.getAttribute("data-width") || "1080", 10),
    height: parseInt(root.getAttribute("data-height") || "1920", 10),
  };
}

/** {@link compositionRootSize} of the first `[data-composition-id]` in `html`, as the renderer queries it. */
export const renderedCompositionSize = (html: string) =>
  compositionRootSize(parseHTML(html).document.querySelector("[data-composition-id]"));
