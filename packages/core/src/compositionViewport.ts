import { parseCompositionDimension } from "./runtime/compositionDimension.js";

export type CompositionViewport = { width: number; height: number };
export const DEFAULT_PREVIEW_VIEWPORT = { width: 1920, height: 1080 } as const;
export { parseCompositionDimension as readPositiveDimension };

type ViewportDocument = Pick<Document, "querySelector">;

export function readCompositionSizeFromDocument(
  doc: ViewportDocument | null | undefined,
): CompositionViewport | null {
  const root =
    doc?.querySelector("[data-composition-id][data-width][data-height]") ??
    doc?.querySelector("[data-width][data-height]");
  if (!root) return null;
  const width = parseCompositionDimension(root.getAttribute("data-width"));
  const height = parseCompositionDimension(root.getAttribute("data-height"));
  return width !== null && height !== null ? { width, height } : null;
}
